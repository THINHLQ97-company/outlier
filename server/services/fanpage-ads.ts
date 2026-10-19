// Bài nào của TRANG NHÀ MÌNH đang chạy quảng cáo (task #6843).
//
// Miễn phí, không Apify: đọc thẳng tài khoản quảng cáo bằng token Meta của
// người đã nối trang. Mỗi quảng cáo đẩy một bài có sẵn của trang thì mang
// `creative.effective_object_story_id` = "{pageId}_{postId}" — đúng mã bài
// Graph trả về ở /posts, nên ghép được chính xác, không phải đoán theo chữ.
// (Cùng cách share-projects/social đã chạy thật với tài khoản "Công Ty MBI - MBC".)
//
// Cần USER token có quyền `ads_read` và được vào tài khoản quảng cáo. Page
// token không liệt kê được tài khoản quảng cáo. Thiếu quyền thì BÁO RÕ — im
// lặng trông y như "trang không chạy quảng cáo nào".
const GRAPH = "https://graph.facebook.com/v21.0";

export type AdsStatus = "ok" | "no_user_token" | "missing_ads_read" | "no_ad_account" | "error";

export interface RawAd {
  id: string;
  effective_status?: string;
  created_time?: string;
  updated_time?: string;
  adset?: { start_time?: string; end_time?: string };
  creative?: { effective_object_story_id?: string };
  insights?: { data?: { spend?: string; impressions?: string; reach?: string }[] };
}

export interface StoryAds {
  adIds: string[];
  spend: number | null;
  impressions: number | null;
  reach: number | null;
  currency: string | null;
  /** Ngày bắt đầu sớm nhất của các quảng cáo đẩy bài (lịch nhóm QC, không có thì ngày tạo QC). */
  startedAt: string | null;
  /** Có ít nhất một quảng cáo đang THẬT SỰ chạy bài này. false = đã chạy, nay đã dừng. */
  running: boolean;
  /**
   * Bài đã dừng: lúc quảng cáo cuối cùng dừng — ngày kết thúc lịch nhóm QC nếu
   * đã qua, không thì lần sửa cuối của quảng cáo (thường là lúc bấm tạm dừng).
   * Là ước lượng gần đúng: Meta không trả "ngày phân phối cuối" cho từng QC.
   */
  endedAt: string | null;
}

export class MetaAdsError extends Error {
  constructor(public status: AdsStatus, message: string) {
    super(message);
  }
}

/** Lỗi Graph → trạng thái người dùng sửa được. */
export function classifyAdsError(e: { code?: number; message?: string } | undefined): MetaAdsError {
  const code = e?.code;
  const msg = String(e?.message || "");
  if (code === 190) {
    return new MetaAdsError("error", "Token Meta đã hết hạn — nối lại trang để lấy token mới.");
  }
  if (code === 200 || code === 10 || /ads_read|ads_management|permission/i.test(msg)) {
    return new MetaAdsError(
      "missing_ads_read",
      "Token thiếu quyền ads_read (đọc quảng cáo). Lấy lại token có thêm quyền ads_read, " +
        "và người lấy token phải được vào tài khoản quảng cáo đang chạy cho trang.",
    );
  }
  if (code === 4 || code === 17 || code === 32 || code === 613) {
    return new MetaAdsError("error", "Meta đang chặn tạm vì gọi quá nhiều — lượt sau sẽ thử lại.");
  }
  return new MetaAdsError("error", `Meta báo lỗi khi đọc quảng cáo: ${msg.slice(0, 200) || "không rõ"}`);
}

async function graph(path: string, token: string, params: Record<string, string> = {}): Promise<any> {
  const url = path.startsWith("http") ? new URL(path) : new URL(`${GRAPH}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (!url.searchParams.has("access_token")) url.searchParams.set("access_token", token);
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.error) throw classifyAdsError(body?.error);
  return body;
}

/** Lật hết các trang kết quả của Graph, có trần để không lật vô hạn. */
async function graphAll(path: string, token: string, params: Record<string, string>, maxPages = 20): Promise<any[]> {
  const out: any[] = [];
  let body = await graph(path, token, params);
  for (let i = 0; i < maxPages; i++) {
    if (Array.isArray(body?.data)) out.push(...body.data);
    const next = body?.paging?.next;
    if (!next) break;
    body = await graph(next, token);
  }
  return out;
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Quảng cáo mới tạo trong khoảng này thì chưa đòi phải có lượt hiển thị. */
const NEW_AD_GRACE_MS = 24 * 3600_000;

/**
 * Quảng cáo có THẬT SỰ đang chạy không.
 *
 * Lỗi đã gặp (2026-10-19): chỉ lọc effective_status = ACTIVE thì bài đã dừng
 * vẫn hiện "đang chạy" — Meta giữ ACTIVE cả khi nhóm quảng cáo đã hết lịch hay
 * tiêu hết ngân sách (Trình quản lý hiện "Đã hoàn tất"). Nên đòi thêm: nhóm
 * quảng cáo chưa qua ngày kết thúc, và có lượt hiển thị trong 2 ngày gần nhất
 * (trừ quảng cáo vừa tạo, chưa kịp phân phối).
 * `recentImpressions` undefined = không có số liệu gần đây để xét, bỏ qua điều kiện đó.
 */
export function isAdRunning(ad: RawAd, now: Date, recentImpressions?: Map<string, number>): boolean {
  if (ad.effective_status && ad.effective_status !== "ACTIVE") return false;
  const end = ad.adset?.end_time ? new Date(ad.adset.end_time).getTime() : null;
  if (end != null && Number.isFinite(end) && end <= now.getTime()) return false;
  if (!recentImpressions) return true;
  if ((recentImpressions.get(String(ad.id)) ?? 0) > 0) return true;
  const created = ad.created_time ? new Date(ad.created_time).getTime() : NaN;
  return Number.isFinite(created) && now.getTime() - created < NEW_AD_GRACE_MS;
}

/** Lúc một quảng cáo đã dừng thì dừng (xem StoryAds.endedAt). */
function adEndedAt(ad: RawAd, now: Date): string | null {
  const end = ad.adset?.end_time;
  if (end && new Date(end).getTime() <= now.getTime()) return end;
  return ad.updated_time || null;
}

/**
 * Gom quảng cáo theo bài được đẩy, chỉ lấy bài của `pageId` — gồm cả quảng
 * cáo ĐÃ DỪNG nếu từng có lượt hiển thị (để biết bài nào đã từng chạy).
 * Quảng cáo không trỏ vào bài có sẵn (bài chỉ để chạy QC, không đăng lên
 * trang) thì không có mã bài — đếm riêng ở `unmatched`.
 */
export function aggregateAdsByStory(
  ads: RawAd[],
  pageId: string,
  currency: string | null = null,
  opts: { now?: Date; recentImpressions?: Map<string, number> } = {},
): { byStory: Map<string, StoryAds>; unmatched: number } {
  const byStory = new Map<string, StoryAds>();
  let unmatched = 0;
  const now = opts.now ?? new Date();
  for (const ad of ads) {
    const ins = ad.insights?.data?.[0];
    const running = isAdRunning(ad, now, opts.recentImpressions);
    // Quảng cáo chưa từng phân phối (bản nháp, bị từ chối) không tính là "đã chạy".
    if (!running && !((num(ins?.impressions) ?? 0) > 0)) continue;
    const story = ad.creative?.effective_object_story_id;
    if (!story) {
      unmatched++;
      continue;
    }
    if (!story.startsWith(`${pageId}_`)) continue; // quảng cáo của trang khác cùng tài khoản
    const cur: StoryAds = byStory.get(story) || {
      adIds: [], spend: null, impressions: null, reach: null, currency, startedAt: null, running: false, endedAt: null,
    };
    if (running) {
      cur.running = true;
    } else {
      const ended = adEndedAt(ad, now);
      if (ended && (!cur.endedAt || new Date(ended).getTime() > new Date(cur.endedAt).getTime())) cur.endedAt = ended;
    }
    const start = ad.adset?.start_time || ad.created_time || null;
    if (start && (!cur.startedAt || new Date(start).getTime() < new Date(cur.startedAt).getTime())) cur.startedAt = start;
    cur.adIds.push(String(ad.id));
    const add = (a: number | null, b: number | null) => (b == null ? a : (a ?? 0) + b);
    cur.spend = add(cur.spend, num(ins?.spend));
    cur.impressions = add(cur.impressions, num(ins?.impressions));
    // Reach không cộng được giữa các quảng cáo (trùng người) — lấy lớn nhất làm cận dưới.
    const r = num(ins?.reach);
    if (r != null) cur.reach = Math.max(cur.reach ?? 0, r);
    byStory.set(story, cur);
  }
  // Còn một quảng cáo đang chạy thì bài đang chạy — không có "ngày dừng".
  for (const v of byStory.values()) if (v.running) v.endedAt = null;
  return { byStory, unmatched };
}

export interface PageAdsResult {
  byStory: Map<string, StoryAds>;
  unmatched: number;
  accounts: number;
}

/**
 * Mọi trạng thái quảng cáo còn xem được — trừ DELETED. Mặc định Graph chỉ trả
 * ACTIVE + PAUSED, bỏ sót quảng cáo đã lưu trữ (ARCHIVED) và nhóm/chiến dịch đã tắt.
 */
const AD_STATUSES = [
  "ACTIVE", "PAUSED", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "ARCHIVED", "IN_PROCESS", "WITH_ISSUES",
];

/** Quảng cáo đang chạy VÀ đã chạy của một trang, qua mọi tài khoản quảng cáo user token vào được. */
export async function fetchActiveAdsForPage(pageId: string, userToken: string): Promise<PageAdsResult> {
  const accounts = await graphAll("me/adaccounts", userToken, { fields: "id,currency,account_status", limit: "50" }, 5);
  if (accounts.length === 0) {
    throw new MetaAdsError(
      "no_ad_account",
      "Token không vào được tài khoản quảng cáo nào. Người lấy token cần được thêm vào tài khoản quảng cáo chạy cho trang.",
    );
  }

  const byStory = new Map<string, StoryAds>();
  let unmatched = 0;
  const now = new Date();
  for (const acc of accounts) {
    const ads: RawAd[] = await graphAll(`${acc.id}/ads`, userToken, {
      fields:
        "id,effective_status,created_time,updated_time,adset{start_time,end_time}," +
        "creative{effective_object_story_id},insights.date_preset(maximum){spend,impressions,reach}",
      effective_status: JSON.stringify(AD_STATUSES),
      limit: "200",
    });
    if (ads.length === 0) continue;
    const recentImpressions = await recentImpressionsByAd(acc.id, userToken, now);
    const part = aggregateAdsByStory(ads, pageId, acc.currency || null, { now, recentImpressions });
    unmatched += part.unmatched;
    for (const [k, v] of part.byStory) {
      const cur = byStory.get(k);
      if (!cur) byStory.set(k, v);
      else {
        cur.adIds.push(...v.adIds);
        cur.spend = (cur.spend ?? 0) + (v.spend ?? 0);
        cur.impressions = (cur.impressions ?? 0) + (v.impressions ?? 0);
        cur.reach = Math.max(cur.reach ?? 0, v.reach ?? 0);
        if (v.startedAt && (!cur.startedAt || v.startedAt < cur.startedAt)) cur.startedAt = v.startedAt;
        cur.running = cur.running || v.running;
        cur.endedAt = cur.running ? null : [cur.endedAt, v.endedAt].filter(Boolean).sort().pop() ?? null;
      }
    }
  }
  return { byStory, unmatched, accounts: accounts.length };
}

/** Lượt hiển thị theo quảng cáo trong 2 ngày gần nhất (hôm qua + hôm nay). */
async function recentImpressionsByAd(accountId: string, token: string, now: Date): Promise<Map<string, number>> {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const rows = await graphAll(`${accountId}/insights`, token, {
    level: "ad",
    fields: "ad_id,impressions",
    time_range: JSON.stringify({ since: day(new Date(now.getTime() - 2 * 86_400_000)), until: day(now) }),
    limit: "500",
  });
  const out = new Map<string, number>();
  for (const r of rows) {
    const n = Number(r.impressions);
    if (r.ad_id && Number.isFinite(n)) out.set(String(r.ad_id), (out.get(String(r.ad_id)) ?? 0) + n);
  }
  return out;
}

// ── Đơn đặt quảng cáo tự chuyển trạng thái ────────────────────────────────

export type AdOrderStatus = "cho_chay" | "dang_chay" | "da_xong" | "huy";
export const AD_ORDER_STATUSES: AdOrderStatus[] = ["cho_chay", "dang_chay", "da_xong", "huy"];

/**
 * Trạng thái mới của một đơn khi job thấy (hoặc không thấy) quảng cáo chạy bài.
 * null = giữ nguyên. Đơn đã xong / huỷ thì job không đụng.
 *
 * `seenRunningSinceStart`: job đã từng thấy quảng cáo chạy bài này kể từ lúc
 * đơn sang "đang chạy". Người chạy tự bấm "đang chạy" mà quảng cáo dùng bài
 * khác (job không ghép được) thì KHÔNG được tự đóng đơn chỉ vì không thấy.
 * Chỉ gọi hàm này khi lượt đọc quảng cáo THÀNH CÔNG — đọc lỗi không phải "đã tắt".
 */
export function autoOrderStatus(
  status: string,
  adRunning: boolean,
  seenRunningSinceStart: boolean,
): AdOrderStatus | null {
  if (status === "cho_chay" && adRunning) return "dang_chay";
  if (status === "dang_chay" && !adRunning && seenRunningSinceStart) return "da_xong";
  return null;
}
