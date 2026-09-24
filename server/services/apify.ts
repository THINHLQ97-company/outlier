// Lớp gọi Apify — thiết kế quanh MỘT ràng buộc: gọi càng ít càng tốt.
// Apify tính tiền theo lượt chạy actor, nên ở đây có 4 lớp phanh:
//   1. CACHE   — kết quả giữ lại APIFY_CACHE_DAYS ngày, trong hạn thì không gọi lại.
//   2. BATCH   — gom nhiều URL vào MỘT lượt chạy, không chạy từng cái.
//   3. TRẦN    — mỗi phiên chỉ enrich tối đa APIFY_ENRICH_LIMIT bài.
//   4. NGÂN SÁCH NGÀY — vượt APIFY_DAILY_RUN_BUDGET lượt/ngày thì từ chối.
// Thiếu APIFY_TOKEN → KHÔNG gọi, trả rỗng kèm cảnh báo (app vẫn chạy được bằng
// số liệu quét miễn phí, chỉ là độ tin cậy thấp hơn).
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { getDb, isDbConfigured } from "../db/client";
import { apifyCache, apifyUsage } from "../db/schema";

const API_BASE = "https://api.apify.com/v2";
const RUN_TIMEOUT_MS = 180_000;

export interface ApifyMetrics {
  itemKey: string;
  url: string;
  title?: string;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  followerCount?: number;
  channelKey?: string;
  channelName?: string;
  publishedAt?: string;
}

export interface EnrichOutcome {
  metrics: ApifyMetrics[];
  fromCache: number;
  fetched: number;
  skipped: number;
  runsUsed: number;
  warning?: string;
}

export function apifyToken(): string {
  return (process.env.APIFY_TOKEN || "").trim();
}
export function isApifyConfigured(): boolean {
  return apifyToken().length > 0;
}
function enrichLimit(): number {
  return Math.max(1, Number(process.env.APIFY_ENRICH_LIMIT) || 25);
}
function cacheDays(): number {
  return Math.max(0, Number(process.env.APIFY_CACHE_DAYS ?? 7));
}
function dailyBudget(): number {
  return Math.max(0, Number(process.env.APIFY_DAILY_RUN_BUDGET ?? 20));
}
// Actor TikTok tính tiền theo SỐ KẾT QUẢ trả về (PAY_PER_EVENT), không phải theo
// lượt chạy — nên phanh theo lượt chạy là chưa đủ: một lượt xin 1000 kết quả vẫn
// đắt. Đây là trần số kết quả mỗi ngày.
//
// Giá đo thực tế 2026-09-18: 2 kết quả tốn $0.00700 → ~$0.0035/kết quả.
// Gói STARTER có hạn mức $29/tháng. Trần 150/ngày ≈ $0.52/ngày ≈ $15.8/tháng,
// nằm an toàn trong hạn mức kể cả khi quét mỗi ngày.
function dailyResultBudget(): number {
  return Math.max(0, Number(process.env.APIFY_DAILY_RESULT_BUDGET ?? 150));
}

/** Giá mỗi kết quả (USD), đo thực tế — dùng để ước tính chi phí trước khi chạy. */
export const USD_PER_RESULT = 0.0035;

/**
 * Trần tiền CỨNG cho mỗi lượt gọi Apify, gửi kèm ngay trong URL.
 *
 * Ngân sách theo ngày chặn được tổng, nhưng không chặn được một lượt chạy đi
 * hoang: actor nhận sai tên trường đầu vào thì nó lờ giới hạn của mình và trả
 * về bao nhiêu tuỳ nó. Trần này do Apify tự áp phía họ, nên nó chặn ngay cả khi
 * code mình tính sai.
 */
export function maxChargePerRunUsd(): number {
  const raw = Number(process.env.APIFY_MAX_CHARGE_PER_RUN_USD ?? 0.4);
  return Number.isFinite(raw) && raw > 0 ? raw : 0.4;
}

/** Ước tính chi phí cho N kết quả, để hiện cho người dùng TRƯỚC khi bấm quét. */
export function estimateCostUsd(resultCount: number): number {
  return Math.max(0, resultCount) * USD_PER_RESULT;
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Actor mặc định theo nền tảng. Đổi được bằng env mà không phải sửa code. */
export function actorFor(platform: string): string | null {
  const map: Record<string, string> = {
    tiktok: process.env.APIFY_ACTOR_TIKTOK || "clockworks~tiktok-scraper",
    instagram: process.env.APIFY_ACTOR_INSTAGRAM || "apify~instagram-scraper",
    youtube: process.env.APIFY_ACTOR_YOUTUBE || "streamers~youtube-scraper",
    // Cùng actor với việc lấy bài lẻ — nó nhận cả URL trang lẫn URL bài.
    facebook: process.env.APIFY_ACTOR_FB_POST || "apify~facebook-posts-scraper",
  };
  return map[platform] || null; // Douyin không qua Apify — dùng f2 miễn phí
}

/** Đã dùng bao nhiêu lượt chạy hôm nay. */
export async function runsUsedToday(): Promise<number> {
  if (!isDbConfigured()) return 0;
  const rows = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(apifyUsage)
    .where(eq(apifyUsage.day, today()));
  return rows[0]?.n ?? 0;
}

/** Đã lấy bao nhiêu KẾT QUẢ hôm nay — đây mới là thứ tính ra tiền. */
export async function resultsUsedToday(): Promise<number> {
  if (!isDbConfigured()) return 0;
  const rows = await getDb()
    .select({ n: sql<number>`coalesce(sum(${apifyUsage.itemCount}), 0)::int` })
    .from(apifyUsage)
    .where(eq(apifyUsage.day, today()));
  return rows[0]?.n ?? 0;
}

async function readCache(keys: string[]): Promise<Map<string, ApifyMetrics>> {
  const out = new Map<string, ApifyMetrics>();
  if (!isDbConfigured() || keys.length === 0 || cacheDays() === 0) return out;
  const since = new Date(Date.now() - cacheDays() * 86_400_000);
  const rows = await getDb()
    .select()
    .from(apifyCache)
    .where(and(inArray(apifyCache.cacheKey, keys), gte(apifyCache.fetchedAt, since)));
  for (const r of rows) out.set(r.cacheKey, r.payload as ApifyMetrics);
  return out;
}

async function writeCache(entries: { key: string; value: ApifyMetrics }[]) {
  if (!isDbConfigured() || entries.length === 0) return;
  for (const e of entries) {
    await getDb()
      .insert(apifyCache)
      .values({ cacheKey: e.key, payload: e.value as any, fetchedAt: new Date() })
      .onConflictDoUpdate({ target: apifyCache.cacheKey, set: { payload: e.value as any, fetchedAt: new Date() } })
      .catch(() => {});
  }
}

/** Chạy actor đồng bộ, lấy thẳng dataset. Một lượt chạy cho NHIỀU url. */
async function runActorSync(actorId: string, input: Record<string, any>): Promise<any[]> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), RUN_TIMEOUT_MS);
  try {
    const url =
      `${API_BASE}/acts/${encodeURIComponent(actorId)}/run-sync-get-dataset-items` +
      `?maxTotalChargeUsd=${maxChargePerRunUsd()}`;
    const res = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apifyToken()}` },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Apify ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } finally {
    clearTimeout(timer);
  }
}

/** Đọc số từ nhiều tên trường khác nhau giữa các actor. */
function pick(o: any, names: string[]): number | undefined {
  for (const n of names) {
    const v = o?.[n];
    const num = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(num) && num >= 0) return num;
  }
  return undefined;
}

// Mỗi actor đặt tên trường một kiểu — đây là bảng quy đổi về một dạng chung.
// Tên trường đã đối chiếu với dataset THẬT (2026-09-18):
//   TikTok  (clockworks): playCount, diggCount, commentCount, shareCount,
//                         authorMeta.fans, createTimeISO
//   YouTube (streamers):  viewCount, likes, commentsCount, numberOfSubscribers,
//                         channelId, channelName, date
export function normalize(raw: any, _platform: string): ApifyMetrics | null {
  const url = raw?.webVideoUrl || raw?.url || raw?.postUrl || raw?.videoUrl;
  if (!url) return null;
  const author = raw?.authorMeta || raw?.author || raw?.channel || {};
  return {
    itemKey: String(raw?.id ?? raw?.videoId ?? raw?.shortCode ?? url),
    url: String(url),
    title: raw?.title ?? raw?.text ?? raw?.caption ?? undefined,
    views: pick(raw, ["playCount", "viewCount", "views", "videoPlayCount"]),
    likes: pick(raw, ["diggCount", "likesCount", "likeCount", "likes"]),
    comments: pick(raw, ["commentCount", "commentsCount", "comments"]),
    shares: pick(raw, ["shareCount", "sharesCount", "shares"]),
    followerCount:
      pick(author, ["fans", "followers", "followersCount", "subscriberCount"]) ??
      pick(raw, ["numberOfSubscribers", "followersCount", "subscriberCount", "channelTotalSubscribers"]),
    channelKey:
      (author?.id && String(author.id)) ||
      (raw?.channelId && String(raw.channelId)) ||
      (raw?.channelUsername && String(raw.channelUsername)) ||
      (author?.name && String(author.name)) ||
      undefined,
    channelName:
      author?.nickName ?? author?.nickname ?? author?.name ?? author?.fullName ??
      raw?.channelName ?? undefined,
    publishedAt: raw?.createTimeISO ?? raw?.date ?? raw?.timestamp ?? raw?.uploadDate ?? undefined,
  };
}

/**
 * Bổ sung số liệu cho danh sách URL.
 * KHÔNG gọi Apify cho item đã có trong cache; phần còn lại gom vào 1 lượt chạy.
 */
export async function enrichMetrics(
  platform: string,
  urls: string[],
  opts: { asProfile?: boolean; limit?: number } = {},
): Promise<EnrichOutcome> {
  const uniq = [...new Set(urls.filter(Boolean))];
  const base: EnrichOutcome = { metrics: [], fromCache: 0, fetched: 0, skipped: 0, runsUsed: 0 };

  if (uniq.length === 0) return base;

  const actor = actorFor(platform);
  if (!actor) {
    return { ...base, skipped: uniq.length, warning: `Nền tảng "${platform}" không lấy số liệu qua Apify (Douyin dùng cách quét miễn phí).` };
  }
  if (!isApifyConfigured()) {
    return { ...base, skipped: uniq.length, warning: "Chưa cấu hình APIFY_TOKEN — bỏ qua bước bổ sung số liệu, điểm sẽ kém tin cậy hơn." };
  }

  // 1) Cache — quét cả kênh thì cache theo kênh + số lượng, vì kết quả khác hẳn
  //    việc tra cứu từng bài lẻ.
  const keyOf = (u: string) =>
    opts.asProfile ? `${platform}:profile:${u}:${opts.limit ?? 20}` : `${platform}:item:${u}`;
  const cached = await readCache(uniq.map(keyOf));
  const metrics: ApifyMetrics[] = [];
  const need: string[] = [];
  for (const u of uniq) {
    const hit = cached.get(keyOf(u));
    if (hit) metrics.push(hit);
    else need.push(u);
  }
  if (need.length === 0) {
    return { ...base, metrics, fromCache: metrics.length };
  }

  // 2) Trần mỗi phiên
  const limit = enrichLimit();
  const take = need.slice(0, limit);
  const skipped = need.length - take.length;

  // 3) Ngân sách ngày — chặn theo CẢ số lượt chạy lẫn số kết quả
  const used = await runsUsedToday();
  if (used >= dailyBudget()) {
    return {
      ...base, metrics, fromCache: metrics.length, skipped: need.length,
      warning: `Đã dùng hết ngân sách ${dailyBudget()} lượt Apify hôm nay — dừng để khỏi phát sinh chi phí. Thử lại ngày mai hoặc nâng APIFY_DAILY_RUN_BUDGET.`,
    };
  }
  const resultsUsed = await resultsUsedToday();
  const resultsLeft = dailyResultBudget() - resultsUsed;
  if (resultsLeft <= 0) {
    return {
      ...base, metrics, fromCache: metrics.length, skipped: need.length,
      warning: `Hôm nay đã lấy ${resultsUsed} kết quả từ Apify, chạm trần ${dailyResultBudget()}. Actor tính tiền theo số kết quả nên dừng tại đây.`,
    };
  }
  // Chỉ xin đúng phần còn lại trong ngân sách.
  const allowed = take.slice(0, resultsLeft);
  const cutByBudget = take.length - allowed.length;

  // 4) MỘT lượt chạy cho tất cả URL còn lại
  let raws: any[] = [];
  try {
    // Quét cả kênh và tra cứu bài lẻ dùng input khác nhau.
    const input = platform === "facebook"
      ? {
          // Actor Facebook nhận thẳng URL trang, và giới hạn tên là resultsLimit
          // — dùng nhầm tên trường thì nó bỏ qua và trả về bao nhiêu tuỳ nó.
          startUrls: allowed.map((url) => ({ url })),
          resultsLimit: opts.asProfile ? Math.min(opts.limit ?? 20, limit) : allowed.length,
        }
      : opts.asProfile
      ? {
          // Actor nhận tên tài khoản, không phải URL đầy đủ.
          profiles: allowed.map((u) => u.replace(/\/+$/, "").split("/").pop()!.replace(/^@/, "")),
          resultsPerPage: Math.min(opts.limit ?? 20, limit),
          shouldDownloadVideos: false, shouldDownloadCovers: false, shouldDownloadSubtitles: false,
        }
      : {
          postURLs: allowed, startUrls: allowed.map((url) => ({ url })),
          // resultsPerPage quyết định tiền: xin đúng số cần, không xin dư.
          resultsPerPage: allowed.length,
          shouldDownloadVideos: false, shouldDownloadCovers: false, shouldDownloadSubtitles: false,
        };
    raws = await runActorSync(actor, input);
  } catch (e: any) {
    return { ...base, metrics, fromCache: metrics.length, skipped: need.length, warning: `Không lấy được số liệu từ Apify: ${e?.message || e}` };
  }

  if (isDbConfigured()) {
    // Ghi theo SỐ KẾT QUẢ NHẬN VỀ (thứ bị tính tiền), không phải số URL đã xin.
    const { recordUsage } = await import("./cost-tracker");
    await recordUsage({ actorId: actor, itemCount: raws.length, kind: "enrich", note: `enrich ${platform}` });
  }

  const fresh: { key: string; value: ApifyMetrics }[] = [];
  for (const r of raws) {
    const m = normalize(r, platform);
    if (!m) continue;
    metrics.push(m);
    // Quét cả kênh trả về nhiều bài từ MỘT url đầu vào — cache theo từng bài
    // để lần sau tra cứu lẻ dùng lại được.
    if (!opts.asProfile) fresh.push({ key: keyOf(m.url), value: m });
    else fresh.push({ key: `${platform}:item:${m.url}`, value: m });
  }
  await writeCache(fresh);

  return {
    metrics, fromCache: cached.size, fetched: fresh.length, skipped: skipped + cutByBudget, runsUsed: 1,
    warning:
      skipped + cutByBudget > 0
        ? `Chỉ bổ sung số liệu cho ${allowed.length} bài (trần ${limit}/phiên, còn ${resultsLeft} kết quả trong ngân sách hôm nay) để tiết kiệm chi phí.`
        : undefined,
  };
}
