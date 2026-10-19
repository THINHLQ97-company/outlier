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
  creative?: { effective_object_story_id?: string };
  insights?: { data?: { spend?: string; impressions?: string; reach?: string }[] };
}

export interface StoryAds {
  adIds: string[];
  spend: number | null;
  impressions: number | null;
  reach: number | null;
  currency: string | null;
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

/**
 * Gom quảng cáo theo bài được đẩy, chỉ lấy bài của `pageId`.
 * Quảng cáo không trỏ vào bài có sẵn (bài chỉ để chạy QC, không đăng lên
 * trang) thì không có mã bài — đếm riêng ở `unmatched`.
 */
export function aggregateAdsByStory(
  ads: RawAd[],
  pageId: string,
  currency: string | null = null,
): { byStory: Map<string, StoryAds>; unmatched: number } {
  const byStory = new Map<string, StoryAds>();
  let unmatched = 0;
  for (const ad of ads) {
    const story = ad.creative?.effective_object_story_id;
    if (!story) {
      unmatched++;
      continue;
    }
    if (!story.startsWith(`${pageId}_`)) continue; // quảng cáo của trang khác cùng tài khoản
    const ins = ad.insights?.data?.[0];
    const cur = byStory.get(story) || { adIds: [], spend: null, impressions: null, reach: null, currency };
    cur.adIds.push(String(ad.id));
    const add = (a: number | null, b: number | null) => (b == null ? a : (a ?? 0) + b);
    cur.spend = add(cur.spend, num(ins?.spend));
    cur.impressions = add(cur.impressions, num(ins?.impressions));
    // Reach không cộng được giữa các quảng cáo (trùng người) — lấy lớn nhất làm cận dưới.
    const r = num(ins?.reach);
    if (r != null) cur.reach = Math.max(cur.reach ?? 0, r);
    byStory.set(story, cur);
  }
  return { byStory, unmatched };
}

export interface PageAdsResult {
  byStory: Map<string, StoryAds>;
  unmatched: number;
  accounts: number;
}

/** Quảng cáo ĐANG CHẠY của một trang, qua mọi tài khoản quảng cáo user token vào được. */
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
  for (const acc of accounts) {
    const ads: RawAd[] = await graphAll(`${acc.id}/ads`, userToken, {
      fields: "id,effective_status,creative{effective_object_story_id},insights.date_preset(maximum){spend,impressions,reach}",
      effective_status: JSON.stringify(["ACTIVE"]),
      limit: "200",
    });
    const part = aggregateAdsByStory(ads, pageId, acc.currency || null);
    unmatched += part.unmatched;
    for (const [k, v] of part.byStory) {
      const cur = byStory.get(k);
      if (!cur) byStory.set(k, v);
      else {
        cur.adIds.push(...v.adIds);
        cur.spend = (cur.spend ?? 0) + (v.spend ?? 0);
        cur.impressions = (cur.impressions ?? 0) + (v.impressions ?? 0);
        cur.reach = Math.max(cur.reach ?? 0, v.reach ?? 0);
      }
    }
  }
  return { byStory, unmatched, accounts: accounts.length };
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
