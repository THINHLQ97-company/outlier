// Kênh theo dõi — thêm kênh đối thủ vào danh sách, làm mới để xem họ vừa đăng gì
// và bài nào đang bật (docs/PRD.md §4 J2).
//
// Mỗi lần làm mới tạo một radar_job bên dưới để tái dùng toàn bộ phần chấm điểm
// và hiển thị đã có. Điểm khác biệt duy nhất: so với các lần trước để ĐÁNH DẤU
// BÀI MỚI — đó là giá trị của việc theo dõi so với quét rời.
import type { Express } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, isDbConfigured } from "../db/client";
import { watchedChannels, channelSeenItems, radarJobs, radarItems } from "../db/schema";
import { requireAuth, getAuthUser } from "../auth-mw";
import { scanCandidates } from "../services/radar-scan";
import { enrichMetrics, estimateCostUsd, isApifyConfigured } from "../services/apify";
import { assertPublicUrl } from "../services/brand-ingest";
import { isActiveAdmin } from "./studio.routes";
import { rescoreRadarJob } from "./radar.routes";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLATFORMS = ["facebook", "youtube", "tiktok", "douyin", "instagram"];
const DEFAULT_LIMIT = 20;

/** Câu mô tả chi phí cho người dùng dễ hình dung. */
function limitCostHint(n: number): string {
  return `khoảng ${estimateCostUsd(n).toFixed(2)} USD cho ${n} bài`;
}

function dbDown(res: any): boolean {
  if (!isDbConfigured()) {
    res.status(503).json({ error: "Tính năng dữ liệu chưa khả dụng (thiếu DATABASE_URL)." });
    return true;
  }
  return false;
}

/** Đoán nền tảng từ link để người dùng khỏi phải chọn tay. */
export function guessPlatform(url: string): string | null {
  const u = url.toLowerCase();
  if (u.includes("youtube.com") || u.includes("youtu.be")) return "youtube";
  if (u.includes("tiktok.com")) return "tiktok";
  if (u.includes("douyin.com")) return "douyin";
  if (u.includes("instagram.com")) return "instagram";
  if (u.includes("facebook.com") || u.includes("fb.com")) return "facebook";
  return null;
}

/** Làm mới một kênh: quét lại, đánh dấu bài mới, chấm điểm. */
/**
 * Số bài nên xin khi làm mới.
 *
 * Lần đầu phải lấy nhiều để dựng mốc so sánh cho kênh. Nhưng những lần sau,
 * kênh chỉ đăng thêm vài bài mỗi ngày — xin lại 20 bài là trả tiền cho 18 bài
 * mình đã có. Apify tính tiền theo số kết quả nó trả về, nó không biết mình đã
 * có gì.
 *
 * Quy tắc: lần đầu lấy đủ; sau đó lấy theo nhịp đăng thật của kênh, cộng biên
 * an toàn để không sót bài nếu hôm đó họ đăng dồn.
 */
export function limitForRefresh(opts: {
  scanCount: number;
  lastScanAt: Date | null;
  postsPerDay?: number | null;
}): number {
  if (opts.scanCount === 0 || !opts.lastScanAt) return DEFAULT_LIMIT;

  const daysSince = Math.max(0.5, (Date.now() - opts.lastScanAt.getTime()) / 86_400_000);
  // Chưa biết nhịp đăng thì đoán 2 bài/ngày — đủ rộng cho phần lớn trang.
  const perDay = opts.postsPerDay && opts.postsPerDay > 0 ? opts.postsPerDay : 2;
  const expected = Math.ceil(daysSince * perDay);

  // Biên an toàn gấp đôi, tối thiểu 5 (xin 1-2 bài thì dễ sót), tối đa 20.
  return Math.min(DEFAULT_LIMIT, Math.max(5, expected * 2));
}

/**
 * Sửa lại số liệu các bài ĐÃ LƯU bằng dữ liệu trong bộ nhớ đệm — không tốn tiền.
 *
 * Vì sao cần: khi code đọc sai tên trường, dữ liệu rơi im lặng (số bình luận
 * trống, ngày về 0) và nằm lại trong cơ sở dữ liệu mãi. Bắt người dùng quét lại
 * là bắt họ trả tiền lần hai cho lỗi của mình — trong khi kết quả gốc vẫn còn
 * nguyên trong bộ nhớ đệm.
 */
/** Gắn số người theo dõi của kênh xuống mọi bài của kênh, rồi chấm điểm lại. */
export async function applyFollowersToItems(channelId: string, followers: number | null): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ id: radarItems.id, jobId: radarItems.jobId })
    .from(radarItems)
    .innerJoin(radarJobs, eq(radarItems.jobId, radarJobs.id))
    .where(eq(radarJobs.watchedChannelId, channelId));
  if (rows.length === 0) return 0;

  for (const r of rows) {
    await db.update(radarItems).set({ followerCount: followers }).where(eq(radarItems.id, r.id));
  }
  for (const jid of [...new Set(rows.map((r) => r.jobId))]) {
    await rescoreRadarJob(jid).catch(() => {});
  }
  return rows.length;
}

export interface RepairResult {
  checked: number;
  fixed: number;
  /** Bài lấy lại được từ dataset của lượt chạy đã trả tiền (miễn phí). */
  fromRuns: number;
  note?: string;
}

/**
 * Vá số liệu thiếu mà KHÔNG quét lại (không tốn thêm tiền).
 *
 * Hai nguồn, theo thứ tự rẻ dần về độ chắc:
 *   1. Bản thô trong cache — có từ bản này trở đi.
 *   2. Dataset của những lượt chạy Apify gần đây — ĐÃ trả tiền rồi, đọc lại
 *      miễn phí. Đây là chỗ cứu được dữ liệu cũ đã cache trước khi biết giữ
 *      bản thô.
 *
 * Bản cache cũ chỉ có dữ liệu ĐÃ chuẩn hoá, nên chuẩn hoá lại nó không thể sinh
 * ra trường mà lần đầu đã đọc hụt — đó là lý do bấm nút mà số bình luận vẫn
 * trống. Nguồn (2) mới là thứ vá được.
 */
export async function repairChannelFromCache(channelId: string): Promise<RepairResult> {
  const db = getDb();
  const [chan] = await db.select().from(watchedChannels).where(eq(watchedChannels.id, channelId));
  if (!chan) return { checked: 0, fixed: 0, fromRuns: 0 };

  const items = await db.select().from(radarItems).where(eq(radarItems.channelKey, chan.channelKey || ""));
  if (items.length === 0) return { checked: 0, fixed: 0, fromRuns: 0 };

  const { apifyCache } = await import("../db/schema");
  const { normalize, cachedRaw, actorFor } = await import("../services/apify");

  const needsWork = items.filter((it) => it.comments == null || it.shares == null || !it.coverUrl);

  // Lấy lại từ dataset của những lượt chạy đã trả tiền. Miễn phí, và là nguồn
  // DUY NHẤT cứu được những bài cache trước khi hệ thống biết giữ bản thô.
  const rawByUrl = new Map<string, any>();
  let fromRuns = 0;
  const actor = actorFor(chan.platform); // null = nền tảng không qua Apify (Douyin)
  if (needsWork.length > 0 && actor) {
    try {
      const { recentRunItems } = await import("../services/apify-runs");
      for (const r of await recentRunItems(actor)) rawByUrl.set(r.url, r.raw);
      fromRuns = rawByUrl.size;
    } catch (e: any) {
      console.warn("[repair] Không đọc được dataset lượt chạy cũ:", e?.message || e);
    }
  }

  let fixed = 0;
  for (const it of items) {
    // Số người theo dõi vá được ngay, không cần hỏi ai: kênh đã biết rồi.
    if (it.followerCount == null && chan.followerCount != null) {
      await db
        .update(radarItems)
        .set({ followerCount: chan.followerCount })
        .where(eq(radarItems.id, it.id));
      fixed++;
    }

    // Chỉ đụng vào bài đang thiếu — không ghi đè dữ liệu đang đúng.
    const missing = it.comments == null || it.shares == null || !it.coverUrl;
    if (!missing) continue;

    // Ưu tiên bản thô (đọc lại được đầy đủ), rồi mới tới cache đã chuẩn hoá.
    const raw = rawByUrl.get(it.url) || (await cachedRaw(chan.platform, it.url));
    let m = raw ? normalize(raw, chan.platform) : null;
    if (!m) {
      const [hit] = await db
        .select()
        .from(apifyCache)
        .where(eq(apifyCache.cacheKey, `${chan.platform}:item:${it.url}`));
      if (!hit?.payload) continue;
      m = normalize((hit.payload as any)?.m ?? hit.payload, chan.platform);
    }
    if (!m) continue;

    await db
      .update(radarItems)
      .set({
        comments: it.comments ?? m.comments ?? null,
        shares: it.shares ?? m.shares ?? null,
        likes: it.likes ?? m.likes ?? null,
        views: it.views ?? m.views ?? null,
        coverUrl: it.coverUrl ?? m.coverUrl ?? null,
        publishedAt: it.publishedAt ?? (m.publishedAt ? new Date(m.publishedAt) : null),
      })
      .where(eq(radarItems.id, it.id));
    fixed++;
  }

  // Vá số liệu xong mà không chấm lại thì điểm vẫn là điểm tính trên dữ liệu
  // thiếu — người dùng thấy comment đổ về nhưng dòng "chưa có số bình luận để
  // đánh giá mức độ chạm" vẫn nằm đó.
  if (fixed > 0) {
    const jobIds = [...new Set(items.map((it) => it.jobId))];
    for (const jid of jobIds) await rescoreRadarJob(jid).catch(() => {});
  }

  const note =
    fixed === 0 && needsWork.length > 0
      ? fromRuns === 0
        ? "Không vá được bài nào: dữ liệu thô của lần quét cũ không còn (Apify đã dọn dataset, và bản cache cũ chỉ lưu số liệu đã đọc được). " +
          "Muốn có số bình luận/chia sẻ cho các bài này thì phải quét lại — lần quét mới sẽ giữ cả bản thô nên về sau sửa được miễn phí."
        : `Đọc lại được ${fromRuns} bài từ lượt quét đã trả tiền, nhưng không bài nào khớp với ${needsWork.length} bài đang thiếu số liệu.`
      : undefined;

  return { checked: items.length, fixed, fromRuns, note };
}

export async function refreshChannelInBackground(channelId: string, limit?: number) {
  const db = getDb();
  try {
    const [chan] = await db.select().from(watchedChannels).where(eq(watchedChannels.id, channelId));
    if (!chan) return;

    await db.update(watchedChannels)
      .set({ scanStatus: "scanning", errorMessage: null, updatedAt: new Date() })
      .where(eq(watchedChannels.id, channelId));

    // Xin đúng số bài cần: lần đầu lấy đủ để dựng mốc, sau đó chỉ lấy phần có
    // thể mới kể từ lần quét trước. Với kênh tính tiền, đây là khoản tiết kiệm
    // lớn nhất — quét hàng ngày mà vẫn xin 20 bài là trả tiền cho 18 bài đã có.
    const effectiveLimit =
      limit ??
      limitForRefresh({
        scanCount: chan.scanCount || 0,
        lastScanAt: chan.lastScanAt ? new Date(chan.lastScanAt) : null,
        postsPerDay: null,
      });

    let r = await scanCandidates(chan.platform, chan.channelUrl, "competitor", effectiveLimit);

    // yt-dlp không lấy được kênh TikTok từ link @user. Nếu người dùng đã bật
    // dịch vụ có phí thì đi đường Apify — quét profile và lấy luôn số liệu đầy đủ.
    if (r.candidates.length === 0 && chan.useApify && isApifyConfigured()) {
      const viaApify = await scanChannelViaApify(
        chan.platform,
        chan.channelUrl,
        effectiveLimit,
        // Lần đầu thì lấy hết; các lần sau chỉ xin bài mới hơn lần quét trước.
        chan.scanCount && chan.lastScanAt ? new Date(chan.lastScanAt) : null,
      );
      if (viaApify.candidates.length) r = viaApify;
      else if (viaApify.warning) r = { candidates: [], warning: viaApify.warning };
    }

    if (r.candidates.length === 0) {
      await db.update(watchedChannels).set({
        scanStatus: "error",
        errorMessage: r.warning || "Không lấy được bài nào từ kênh này.",
        lastScanAt: new Date(), updatedAt: new Date(),
      }).where(eq(watchedChannels.id, channelId));
      return;
    }

    // Bài nào đã từng thấy ở các lần trước?
    const keys = r.candidates.map((c) => c.itemKey);
    const seenRows = await db.select({ itemKey: channelSeenItems.itemKey })
      .from(channelSeenItems)
      .where(and(eq(channelSeenItems.channelId, channelId), inArray(channelSeenItems.itemKey, keys)));
    const seen = new Set(seenRows.map((s) => s.itemKey));
    // Lần quét ĐẦU TIÊN thì mọi bài đều "mới" về mặt kỹ thuật, nhưng đánh dấu
    // tất cả là mới thì vô nghĩa — chỉ đánh dấu từ lần làm mới thứ hai trở đi.
    const isFirstScan = chan.lastScanAt === null;
    const newKeys = isFirstScan ? [] : keys.filter((k) => !seen.has(k));

    const [job] = await db.insert(radarJobs).values({
      owner: chan.owner, watchedChannelId: channelId,
      query: chan.channelUrl, queryKind: "competitor",
      platforms: [chan.platform], status: "scanning",
    }).returning();

    // Facebook hiếm khi kèm số người theo dõi trong dữ liệu bài. Hai đường, rẻ
    // trước: Graph (miễn phí) → actor hồ sơ trang của Apify (một kết quả, rẻ, và
    // nhớ 30 ngày vì số này đổi rất chậm). Chỉ khi cả hai trượt mới cần người
    // nhập tay — bắt nhập tay khi máy tự lấy được là bắt làm việc thừa.
    // Hỏi lại MỖI LẦN quét, không chỉ lần đầu: số người theo dõi thay đổi theo
    // thời gian, và mốc so sánh tính trên số cũ thì sai dần. Không sợ tốn: Graph
    // miễn phí, còn Apify chỉ chạy khi Graph trượt VÀ bản nhớ đã quá 30 ngày.
    let graphFollowers: number | null = null;
    if (chan.platform === "facebook") {
      try {
        const { fetchPublicPageFollowers } = await import("../services/fb-public-page");
        const out = await fetchPublicPageFollowers(chan.channelUrl);
        graphFollowers = out.followers;
        if (!out.followers && out.reason) console.warn(`[channels] Người theo dõi qua Graph: ${out.reason}`);
      } catch {
        // Không lấy được thì xuống đường Apify bên dưới.
      }

      if (graphFollowers == null && chan.useApify && isApifyConfigured()) {
        try {
          const { fetchPageProfile } = await import("../services/apify");
          const prof = await fetchPageProfile("facebook", chan.channelUrl);
          graphFollowers = prof.followers;
          if (prof.followers == null && prof.reason) {
            console.warn(`[channels] Người theo dõi qua Apify: ${prof.reason}`);
          }
        } catch (e: any) {
          console.warn("[channels] Lấy hồ sơ trang qua Apify thất bại:", e?.message || e);
        }
      }
    }

    // Số người theo dõi của KÊNH — lấy từ bài nào có, hoặc từ lần quét trước.
    //
    // Phải biết trước khi chèn bài: việc chấm "vượt bao nhiêu lần mức thường
    // ngày" đọc số này ở TỪNG BÀI. Trước đây chỉ ghi vào kênh, nên trang hiện
    // "750 N theo dõi" ngay bên cạnh dòng "chưa có số người theo dõi để so
    // sánh" — biết mà không dùng được, vì để nhầm chỗ.
    // Số vừa lấy được thắng số cũ — kể cả số người dùng nhập tay, vì nhập tay
    // chỉ là đường tạm khi máy chưa lấy được.
    const knownFollowers =
      r.candidates.find((c) => c.followerCount != null)?.followerCount ?? graphFollowers ?? chan.followerCount;

    await db.insert(radarItems).values(r.candidates.map((c) => ({
      jobId: job.id, platform: c.platform, itemKey: c.itemKey, url: c.url,
      title: c.title ?? null, coverUrl: c.coverUrl ?? null, durationSec: c.durationSec ?? null,
      publishedAt: c.publishedAt ? new Date(c.publishedAt) : null,
      channelKey: c.channelKey ?? null, channelName: c.channelName ?? null,
      followerCount: c.followerCount ?? knownFollowers,
      views: c.views ?? null, likes: c.likes ?? null,
      contentKind: (c as any).contentKind || "unknown",
      metricsSource: (c as any).__fromApify ? "apify" : "scan",
      isNew: newKeys.includes(c.itemKey),
    })));

    await rescoreRadarJob(job.id);

    // Ghi nhận các bài vừa thấy để lần sau so sánh.
    const unseen = keys.filter((k) => !seen.has(k));
    if (unseen.length) {
      await db.insert(channelSeenItems)
        .values(unseen.map((itemKey) => ({ channelId, itemKey })))
        .catch(() => {});
    }

    await db.update(radarJobs)
      .set({ status: "ready", scannedCount: r.candidates.length, errorMessage: r.warning || null, updatedAt: new Date() })
      .where(eq(radarJobs.id, job.id));

    const first = r.candidates.find((c) => c.channelKey || c.channelName || c.followerCount);
    // Avatar có thể nằm ở bài khác với bài mang tên kênh, nên tìm riêng.
    const withAvatar = r.candidates.find((c) => (c as any).channelAvatarUrl);
    await db.update(watchedChannels).set({
      scanStatus: "idle", errorMessage: null,
      lastScanAt: new Date(), lastJobId: job.id, lastNewCount: newKeys.length,
      scanCount: (chan.scanCount || 0) + 1,
      channelKey: chan.channelKey ?? first?.channelKey ?? null,
      // Tên quét được thắng tên cũ: lần đầu thêm kênh thì tên chính là URL,
      // giữ nó lại thì danh sách mãi hiện đường dẫn thay vì tên trang.
      channelName: first?.channelName ?? chan.channelName ?? null,
      channelAvatarUrl: (withAvatar as any)?.channelAvatarUrl ?? chan.channelAvatarUrl ?? null,
      followerCount: first?.followerCount ?? graphFollowers ?? chan.followerCount,
      updatedAt: new Date(),
    }).where(eq(watchedChannels.id, channelId));
  } catch (e: any) {
    console.error("refresh channel:", e?.message || e);
    await getDb().update(watchedChannels)
      .set({ scanStatus: "error", errorMessage: String(e?.message || e).slice(0, 300), updatedAt: new Date() })
      .where(eq(watchedChannels.id, channelId))
      .catch(() => {});
  }
}

/**
 * Quét kênh qua Apify — dùng khi công cụ miễn phí không làm được (TikTok).
 * TỐN TIỀN: tính theo số bài lấy về. Chỉ gọi khi kênh đã bật useApify.
 */
async function scanChannelViaApify(
  platform: string,
  channelUrl: string,
  limit: number,
  newerThan?: Date | null,
) {
  // newerThan: chỉ xin bài mới hơn lần quét trước — actor không nhận danh sách
  // "bỏ qua bài này", nhưng nhận mốc ngày, và tác dụng là như nhau.
  const out = await enrichMetrics(platform, [channelUrl], { asProfile: true, limit, newerThan });
  const candidates = out.metrics.map((m) => ({
    platform, itemKey: m.itemKey, url: m.url,
    // Ảnh bài lấy thẳng từ dữ liệu actor trả về — trước đây bỏ trống nên danh
    // sách toàn ô ảnh rỗng, dù actor có gửi ảnh kèm.
    title: m.title, coverUrl: m.coverUrl, durationSec: undefined,
    // Facebook là bài viết (chữ + ảnh); TikTok/Instagram là video.
    contentKind: (platform === "facebook" ? "post" : "video") as any,
    publishedAt: m.publishedAt,
    channelKey: m.channelKey, channelName: m.channelName,
    channelAvatarUrl: m.channelAvatarUrl,
    followerCount: m.followerCount,
    views: m.views, likes: m.likes,
    __fromApify: true,
  })) as any[];
  return { candidates, warning: out.warning };
}

export function registerChannelRoutes(app: Express) {
  app.get("/api/channels", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const username = getAuthUser(req)!;
    try {
      const rows = await getDb().select().from(watchedChannels)
        .where(eq(watchedChannels.owner, username))
        .orderBy(desc(watchedChannels.updatedAt)).limit(100);
      res.json(rows);
    } catch (e: any) {
      console.error("channels list:", e?.message || e);
      res.status(500).json({ error: "Không tải được danh sách kênh." });
    }
  });

  // ===== Thêm kênh vào danh sách theo dõi =====
  app.post("/api/channels", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const username = getAuthUser(req)!;
    const url = String(req.body?.channelUrl || "").trim();
    const note = String(req.body?.note || "").trim() || null;
    if (!url) return res.status(400).json({ error: "Dán link kênh muốn theo dõi." });

    try {
      assertPublicUrl(url);
    } catch (e: any) {
      return res.status(400).json({ error: e?.message || "Link không hợp lệ." });
    }

    const platform = PLATFORMS.includes(req.body?.platform) ? req.body.platform : guessPlatform(url);
    if (!platform) {
      return res.status(400).json({ error: "Không nhận ra kênh thuộc nền tảng nào. Hỗ trợ: YouTube, TikTok, Douyin, Instagram." });
    }
    if (platform === "douyin") {
      return res.status(400).json({ error: "Douyin cần bộ quét riêng, chưa nối trong bản này." });
    }

    // TikTok và Instagram không quét kênh được bằng công cụ miễn phí — phải qua
    // dịch vụ có phí, nên người dùng phải chủ động đồng ý trước.
    const needsPaid = platform === "tiktok" || platform === "instagram" || platform === "facebook";
    const useApify = needsPaid ? req.body?.useApify === true : false;
    if (needsPaid && !useApify) {
      return res.status(400).json({
        error: `Kênh ${platform === "tiktok" ? "TikTok" : platform === "facebook" ? "Facebook" : "Instagram"} không lấy được bằng công cụ miễn phí. ` +
               `Cần dùng dịch vụ có phí — mỗi lần làm mới ${limitCostHint(20)}.`,
        needsPaid: true,
        estimatedCostUsd: Number(estimateCostUsd(20).toFixed(4)),
        apifyConfigured: isApifyConfigured(),
      });
    }
    if (needsPaid && !isApifyConfigured()) {
      return res.status(400).json({ error: "Chưa cấu hình dịch vụ có phí nên chưa theo dõi được kênh này." });
    }

    try {
      const [existing] = await getDb().select().from(watchedChannels)
        .where(and(eq(watchedChannels.owner, username), eq(watchedChannels.channelUrl, url)));
      if (existing) return res.status(409).json({ error: "Kênh này đã có trong danh sách theo dõi.", id: existing.id });

      const [row] = await getDb().insert(watchedChannels)
        .values({ owner: username, platform, channelUrl: url, note, useApify, scanStatus: "scanning" })
        .returning();

      res.status(201).json({ ...row, polling: true, message: "Đã thêm kênh. Đang lấy bài lần đầu, khoảng 30-60 giây." });
      void refreshChannelInBackground(row.id);
    } catch (e: any) {
      console.error("channel add:", e?.message || e);
      res.status(500).json({ error: "Không thêm được kênh." });
    }
  });

  // ===== Làm mới: xem kênh vừa đăng gì =====
  app.post("/api/channels/:id/refresh", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "Mã kênh không hợp lệ." });
    try {
      const [chan] = await getDb().select().from(watchedChannels).where(eq(watchedChannels.id, id));
      if (!chan) return res.status(404).json({ error: "Không tìm thấy kênh." });
      const username = getAuthUser(req)!;
      if (chan.owner !== username && !(await isActiveAdmin(username))) {
        return res.status(403).json({ error: "Không có quyền làm mới kênh này." });
      }
      if (chan.scanStatus === "scanning") return res.status(409).json({ error: "Kênh này đang được quét, chờ một chút." });

      res.json({ ...chan, scanStatus: "scanning", polling: true, message: "Đang lấy bài mới, khoảng 30-60 giây." });
      void refreshChannelInBackground(id, Math.min(Math.max(1, Number(req.body?.limit) || DEFAULT_LIMIT), 50));
    } catch (e: any) {
      console.error("channel refresh:", e?.message || e);
      res.status(500).json({ error: "Không làm mới được kênh." });
    }
  });

  // ===== Bài của kênh, bài mới lên đầu =====
  app.get("/api/channels/:id/items", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "Mã kênh không hợp lệ." });
    try {
      const [chan] = await getDb().select().from(watchedChannels).where(eq(watchedChannels.id, id));
      if (!chan) return res.status(404).json({ error: "Không tìm thấy kênh." });
      const username = getAuthUser(req)!;
      if (chan.owner !== username && !(await isActiveAdmin(username))) {
        return res.status(403).json({ error: "Không có quyền xem kênh này." });
      }
      // Gom bài của MỌI lần quét kênh này, không chỉ lần gần nhất.
      //
      // Trước đây chỉ đọc lastJobId. Hồi mỗi lần quét đều xin 20 bài thì phiên
      // mới nhất gần như chứa đủ, nên không ai thấy vấn đề. Từ khi chỉ xin bài
      // MỚI HƠN lần quét trước (để khỏi trả tiền cho bài đã có), phiên mới chỉ
      // có vài bài — và cả trang chỉ còn vài bài, trông như vừa xoá sạch bài cũ.
      // Bài cũ chưa bao giờ mất, chỉ là không được đọc lên.
      const rows = await getDb()
        .select({ item: radarItems })
        .from(radarItems)
        .innerJoin(radarJobs, eq(radarItems.jobId, radarJobs.id))
        .where(eq(radarJobs.watchedChannelId, id))
        .orderBy(desc(radarItems.createdAt))
        .limit(500);

      // Một bài có thể xuất hiện ở nhiều phiên (lần quét sau vẫn trả về nó).
      // Giữ bản GIÀU dữ liệu nhất: bản có số liệu tính tiền hơn bản quét chay,
      // và trong cùng hạng thì bản mới hơn.
      const richness = (it: any) =>
        (it.metricsSource === "apify" ? 4 : 0) +
        (it.comments != null ? 2 : 0) +
        (it.shares != null ? 1 : 0) +
        (it.coverUrl ? 1 : 0);
      const best = new Map<string, any>();
      for (const { item } of rows) {
        const key = item.itemKey || item.url;
        const cur = best.get(key);
        if (!cur) {
          best.set(key, item);
          continue;
        }
        // isNew giữ lại nếu BẤT KỲ bản nào từng được đánh dấu mới.
        const merged = richness(item) > richness(cur) ? { ...item } : { ...cur };
        merged.isNew = cur.isNew || item.isNew;
        best.set(key, merged);
      }

      const items = [...best.values()]
        .sort((a, b) => {
          if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
          const at = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
          const bt = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
          if (at !== bt) return bt - at;
          return (b.outperformScore ?? 0) - (a.outperformScore ?? 0);
        })
        .slice(0, 100);

      res.json({ ...chan, items });
    } catch (e: any) {
      console.error("channel items:", e?.message || e);
      res.status(500).json({ error: "Không tải được bài của kênh." });
    }
  });

  app.patch("/api/channels/:id", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "Mã kênh không hợp lệ." });
    try {
      const [chan] = await getDb().select().from(watchedChannels).where(eq(watchedChannels.id, id));
      if (!chan) return res.status(404).json({ error: "Không tìm thấy kênh." });
      const username = getAuthUser(req)!;
      if (chan.owner !== username && !(await isActiveAdmin(username))) {
        return res.status(403).json({ error: "Không có quyền sửa kênh này." });
      }
      const patch: Record<string, any> = { updatedAt: new Date() };
      if (typeof req.body?.note === "string") patch.note = req.body.note.trim() || null;
      if (typeof req.body?.isActive === "boolean") patch.isActive = req.body.isActive;

      // Nhập tay số người theo dõi.
      //
      // Cần đường này vì với trang của NGƯỜI KHÁC, Meta chỉ cho đọc số công khai
      // nếu ứng dụng đã được duyệt "Page Public Content Access", còn Apify thì
      // không phải lúc nào cũng trả về. Không có số này thì việc chấm "vượt mấy
      // lần mức thường ngày" mất một trục — mà người dùng chỉ cần nhìn trang là
      // đọc được con số đó trong hai giây.
      let followersChanged = false;
      if (req.body?.followerCount !== undefined) {
        const raw = req.body.followerCount;
        const n = raw === null || raw === "" ? null : Number(String(raw).replace(/[.,\s]/g, ""));
        if (n !== null && (!Number.isFinite(n) || n < 0)) {
          return res.status(400).json({ error: "Số người theo dõi không hợp lệ." });
        }
        patch.followerCount = n;
        followersChanged = true;
      }

      const [row] = await getDb().update(watchedChannels).set(patch).where(eq(watchedChannels.id, id)).returning();

      // Gắn xuống từng bài rồi chấm lại — để trong kênh mà không xuống bài thì
      // đúng lỗi cũ: biết số mà không dùng được.
      if (followersChanged) await applyFollowersToItems(id, row.followerCount ?? null);

      res.json(row);
    } catch (e: any) {
      console.error("channel patch:", e?.message || e);
      res.status(500).json({ error: "Không lưu được thay đổi." });
    }
  });

  // Sửa lại số liệu bài cũ từ bộ nhớ đệm — MIỄN PHÍ, không gọi dịch vụ nào.
  app.post("/api/channels/:id/repair", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "Mã không hợp lệ." });
    try {
      const out = await repairChannelFromCache(id);
      res.json({
        ...out,
        note:
          out.fixed > 0
            ? `Đã sửa ${out.fixed}/${out.checked} bài bằng dữ liệu đã trả tiền từ trước — không tốn thêm đồng nào.` +
              (out.fromRuns > 0 ? ` (Đọc lại ${out.fromRuns} bài từ dataset lượt quét cũ.)` : "")
            : out.checked === 0
            ? "Chưa có bài nào để sửa."
            : // Nói đúng lý do thay vì đổ cho "hết hạn bộ nhớ đệm": phần lớn
              // trường hợp là bản cache cũ chỉ lưu số liệu ĐÃ đọc được, nên
              // chuẩn hoá lại không sinh thêm được gì.
              out.note ||
              "Không tìm thấy dữ liệu cũ để vá. Muốn đủ số liệu thì phải quét lại, và lần đó tốn tiền.",
      });
    } catch (e: any) {
      console.error("repair channel:", e?.message || e);
      res.status(500).json({ error: "Không sửa được." });
    }
  });

  app.delete("/api/channels/:id", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "Mã kênh không hợp lệ." });
    try {
      const [chan] = await getDb().select().from(watchedChannels).where(eq(watchedChannels.id, id));
      if (!chan) return res.status(404).json({ error: "Không tìm thấy kênh." });
      const username = getAuthUser(req)!;
      if (chan.owner !== username && !(await isActiveAdmin(username))) {
        return res.status(403).json({ error: "Không có quyền xoá kênh này." });
      }
      await getDb().delete(channelSeenItems).where(eq(channelSeenItems.channelId, id));
      await getDb().delete(watchedChannels).where(eq(watchedChannels.id, id));
      res.json({ success: true });
    } catch (e: any) {
      console.error("channel delete:", e?.message || e);
      res.status(500).json({ error: "Không xoá được kênh." });
    }
  });
}
