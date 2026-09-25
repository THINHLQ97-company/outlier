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
  /** Ảnh đại diện của bài — thiếu thì danh sách chỉ toàn ô trống. */
  coverUrl?: string;
  /** Ảnh đại diện của kênh/trang. */
  channelAvatarUrl?: string;
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

/**
 * Cache giữ CẢ bản đã chuẩn hoá LẪN dữ liệu thô của actor.
 *
 * Trước đây chỉ giữ bản chuẩn hoá, và đó là một mất mát âm thầm: khi ánh xạ tên
 * trường sai (actor đổi tên, hoặc ta đoán sai từ đầu), số liệu thành null vĩnh
 * viễn — sửa lại ánh xạ cũng không cứu được, vì thứ chưa từng đọc ra thì không
 * có trong cache. Muốn có lại phải quét lại, tức là trả tiền lần nữa cho dữ
 * liệu đã mua rồi.
 *
 * Giữ bản thô thì ánh xạ sai vẫn sửa được miễn phí, và còn xem được actor thật
 * sự trả về những trường gì thay vì đoán.
 */
interface CacheEntry {
  m: ApifyMetrics;
  raw?: any;
}

/** Đọc cache, chấp nhận cả bản cũ (chỉ có phần đã chuẩn hoá, không có thô). */
function unpack(payload: any): CacheEntry | null {
  if (!payload || typeof payload !== "object") return null;
  if (payload.m && typeof payload.m === "object") return payload as CacheEntry;
  return { m: payload as ApifyMetrics }; // bản cũ
}

async function readCacheEntries(keys: string[]): Promise<Map<string, CacheEntry>> {
  const out = new Map<string, CacheEntry>();
  if (!isDbConfigured() || keys.length === 0 || cacheDays() === 0) return out;
  const since = new Date(Date.now() - cacheDays() * 86_400_000);
  const rows = await getDb()
    .select()
    .from(apifyCache)
    .where(and(inArray(apifyCache.cacheKey, keys), gte(apifyCache.fetchedAt, since)));
  for (const r of rows) {
    const e = unpack(r.payload);
    if (e) out.set(r.cacheKey, e);
  }
  return out;
}

async function readCache(keys: string[]): Promise<Map<string, ApifyMetrics>> {
  const out = new Map<string, ApifyMetrics>();
  for (const [k, e] of await readCacheEntries(keys)) out.set(k, e.m);
  return out;
}

/** Đọc dữ liệu thô đã cache cho một url (null = bản cache cũ, không có thô). */
export async function cachedRaw(platform: string, url: string): Promise<any | null> {
  const entries = await readCacheEntries([`${platform}:item:${url}`]);
  return entries.get(`${platform}:item:${url}`)?.raw ?? null;
}

async function writeCache(entries: { key: string; value: ApifyMetrics; raw?: any }[]) {
  if (!isDbConfigured() || entries.length === 0) return;
  for (const e of entries) {
    const payload: CacheEntry = { m: e.value, ...(e.raw ? { raw: e.raw } : {}) };
    await getDb()
      .insert(apifyCache)
      .values({ cacheKey: e.key, payload: payload as any, fetchedAt: new Date() })
      .onConflictDoUpdate({ target: apifyCache.cacheKey, set: { payload: payload as any, fetchedAt: new Date() } })
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
/**
 * Đọc một con số từ dữ liệu actor, chấp nhận vài kiểu đóng gói khác nhau.
 *
 * Cạm bẫy đã vấp: `Number(null)` và `Number("")` đều ra 0, nên bản cũ biến
 * trường RỖNG thành "0 bình luận" — tệ hơn hẳn việc để trống, vì con số 0 trông
 * như đã biết chắc. Giờ chỉ nhận số thật và chuỗi số thật.
 *
 * Một số actor gói số trong object (`{ count: 12 }`); đọc `count`/`total` là
 * đọc đúng thứ nó ghi, không phải suy đoán.
 */
function pick(o: any, names: string[]): number | undefined {
  for (const n of names) {
    const v = o?.[n];

    if (typeof v === "number") {
      if (Number.isFinite(v) && v >= 0) return v;
      continue;
    }

    if (typeof v === "string") {
      const trimmed = v.trim();
      if (!trimmed) continue;
      // "1,234" / "1 234" là cách vài actor trả số đã định dạng.
      const num = Number(trimmed.replace(/[,\s]/g, ""));
      if (Number.isFinite(num) && num >= 0) return num;
      continue;
    }

    if (v && typeof v === "object" && !Array.isArray(v)) {
      const inner = pick(v, ["count", "total", "totalCount", "value"]);
      if (inner != null) return inner;
    }
  }
  return undefined;
}

// Mỗi actor đặt tên trường một kiểu — đây là bảng quy đổi về một dạng chung.
// Tên trường đã đối chiếu với dataset THẬT (2026-09-18):
//   TikTok  (clockworks): playCount, diggCount, commentCount, shareCount,
//                         authorMeta.fans, createTimeISO
//   YouTube (streamers):  viewCount, likes, commentsCount, numberOfSubscribers,
//                         channelId, channelName, date
/** Lấy ảnh đầu tiên tìm được trong đống media mà actor trả về. */
function firstImage(raw: any): string | undefined {
  const direct =
    raw?.thumbnailUrl ?? raw?.thumbnail ?? raw?.imageUrl ?? raw?.image ?? raw?.displayUrl ??
    raw?.coverUrl ?? raw?.cover ?? raw?.previewImage;
  if (typeof direct === "string" && direct.startsWith("http")) return direct;

  // Facebook nhét ảnh vào mảng media với vài kiểu lồng nhau khác nhau.
  const media = Array.isArray(raw?.media) ? raw.media : Array.isArray(raw?.images) ? raw.images : [];
  for (const m of media) {
    const u =
      (typeof m === "string" ? m : null) ??
      m?.thumbnail ?? m?.image?.uri ?? m?.photo_image?.uri ?? m?.url ?? m?.src;
    if (typeof u === "string" && u.startsWith("http")) return u;
  }
  return undefined;
}

/**
 * Đưa dữ liệu thô của từng actor về một hình dạng chung.
 *
 * Mỗi actor đặt tên trường một kiểu, và Facebook khác xa TikTok/YouTube: ngày
 * đăng nằm ở `time`, tên trang ở `user.name` hoặc `pageName`, ảnh nằm trong
 * mảng `media`. Trước đây hàm này bỏ qua hẳn nền tảng nên dữ liệu Facebook rơi
 * hết — ngày về 0 nên hiện thành năm 1970, comment và ảnh thì trống.
 */
export function normalize(raw: any, platform: string): ApifyMetrics | null {
  const url = raw?.webVideoUrl || raw?.url || raw?.postUrl || raw?.topLevelUrl || raw?.videoUrl || raw?.facebookUrl;
  if (!url) return null;
  const author = raw?.authorMeta || raw?.author || raw?.channel || raw?.user || {};
  return {
    itemKey: String(raw?.id ?? raw?.videoId ?? raw?.shortCode ?? url),
    url: String(url),
    title: raw?.title ?? raw?.text ?? raw?.caption ?? undefined,
    views: pick(raw, ["playCount", "viewCount", "views", "videoPlayCount"]),
    likes: pick(raw, ["diggCount", "likesCount", "likeCount", "likes"]),
    // Facebook trả `comments`/`shares` là SỐ, nhưng vài actor khác trả MẢNG —
    // pick() chỉ nhận số nên mảng bị bỏ qua, đúng ý.
    comments: pick(raw, ["commentCount", "commentsCount", "comments", "commentsCount"]),
    shares: pick(raw, ["shareCount", "sharesCount", "shares", "sharesCount"]),
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
      raw?.channelName ?? raw?.pageName ?? raw?.user?.name ?? undefined,
    // `time` là tên Facebook dùng — thiếu nó thì ngày về 0 và hiện thành 1970.
    publishedAt:
      raw?.createTimeISO ?? raw?.date ?? raw?.time ?? raw?.timestamp ?? raw?.uploadDate ??
      raw?.publishedAt ?? undefined,
    coverUrl: firstImage(raw),
    channelAvatarUrl:
      author?.avatar ?? author?.profilePicUrl ?? author?.profilePic ?? raw?.user?.profilePic ??
      raw?.pageProfilePicture ?? undefined,
  };
}

/**
 * Bổ sung số liệu cho danh sách URL.
 * KHÔNG gọi Apify cho item đã có trong cache; phần còn lại gom vào 1 lượt chạy.
 */
export async function enrichMetrics(
  platform: string,
  urls: string[],
  opts: { asProfile?: boolean; limit?: number; newerThan?: Date | null } = {},
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
    // Không có cách bảo actor "bỏ qua các bài này" — nó nhận đường dẫn TRANG rồi
    // tự quyết lấy bài nào. Nhưng lọc theo NGÀY thì được, và hiệu quả tương
    // đương: truyền ngày quét lần trước thì nó chỉ trả bài mới hơn, nên chỉ
    // tính tiền cho bài mới.
    const newerThanISO =
      opts.newerThan instanceof Date && Number.isFinite(opts.newerThan.getTime())
        ? opts.newerThan.toISOString().slice(0, 10)
        : undefined;

    const input = platform === "facebook"
      ? {
          // Actor Facebook nhận thẳng URL trang, và giới hạn tên là resultsLimit
          // — dùng nhầm tên trường thì nó bỏ qua và trả về bao nhiêu tuỳ nó.
          startUrls: allowed.map((url) => ({ url })),
          resultsLimit: opts.asProfile ? Math.min(opts.limit ?? 20, limit) : allowed.length,
          ...(newerThanISO ? { onlyPostsNewerThan: newerThanISO } : {}),
        }
      : opts.asProfile
      ? {
          // Actor nhận tên tài khoản, không phải URL đầy đủ.
          profiles: allowed.map((u) => u.replace(/\/+$/, "").split("/").pop()!.replace(/^@/, "")),
          resultsPerPage: Math.min(opts.limit ?? 20, limit),
          // TikTok gọi tham số lọc ngày là oldestPostDate.
          ...(newerThanISO ? { oldestPostDate: newerThanISO } : {}),
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

  const fresh: { key: string; value: ApifyMetrics; raw?: any }[] = [];
  for (const r of raws) {
    const m = normalize(r, platform);
    if (!m) continue;
    metrics.push(m);
    // Quét cả kênh trả về nhiều bài từ MỘT url đầu vào — cache theo từng bài
    // để lần sau tra cứu lẻ dùng lại được. Kèm bản thô để còn sửa được ánh xạ
    // về sau mà không phải trả tiền quét lại.
    if (!opts.asProfile) fresh.push({ key: keyOf(m.url), value: m, raw: r });
    else fresh.push({ key: `${platform}:item:${m.url}`, value: m, raw: r });
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
