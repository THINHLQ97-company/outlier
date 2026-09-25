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
export async function repairChannelFromCache(channelId: string): Promise<{ checked: number; fixed: number }> {
  const db = getDb();
  const [chan] = await db.select().from(watchedChannels).where(eq(watchedChannels.id, channelId));
  if (!chan) return { checked: 0, fixed: 0 };

  const items = await db.select().from(radarItems).where(eq(radarItems.channelKey, chan.channelKey || ""));
  if (items.length === 0) return { checked: 0, fixed: 0 };

  const { apifyCache } = await import("../db/schema");
  const { normalize } = await import("../services/apify");

  let fixed = 0;
  for (const it of items) {
    // Chỉ đụng vào bài đang thiếu — không ghi đè dữ liệu đang đúng.
    const missing = it.comments == null || it.shares == null || !it.coverUrl;
    if (!missing) continue;

    const [hit] = await db
      .select()
      .from(apifyCache)
      .where(eq(apifyCache.cacheKey, `${chan.platform}:item:${it.url}`));
    if (!hit?.payload) continue;

    const m = normalize(hit.payload, chan.platform);
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

  return { checked: items.length, fixed };
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
      const viaApify = await scanChannelViaApify(chan.platform, chan.channelUrl, effectiveLimit);
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

    await db.insert(radarItems).values(r.candidates.map((c) => ({
      jobId: job.id, platform: c.platform, itemKey: c.itemKey, url: c.url,
      title: c.title ?? null, coverUrl: c.coverUrl ?? null, durationSec: c.durationSec ?? null,
      publishedAt: c.publishedAt ? new Date(c.publishedAt) : null,
      channelKey: c.channelKey ?? null, channelName: c.channelName ?? null,
      followerCount: c.followerCount ?? null,
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
      followerCount: first?.followerCount ?? chan.followerCount ?? null,
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
async function scanChannelViaApify(platform: string, channelUrl: string, limit: number) {
  const out = await enrichMetrics(platform, [channelUrl], { asProfile: true, limit });
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
      if (!chan.lastJobId) return res.json({ ...chan, items: [] });

      const items = await getDb().select().from(radarItems)
        .where(eq(radarItems.jobId, chan.lastJobId))
        .orderBy(desc(radarItems.isNew), desc(radarItems.outperformScore))
        .limit(100);
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
      const [row] = await getDb().update(watchedChannels).set(patch).where(eq(watchedChannels.id, id)).returning();
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
            ? `Đã sửa ${out.fixed}/${out.checked} bài bằng dữ liệu đã lưu — không tốn đồng nào.`
            : out.checked === 0
            ? "Chưa có bài nào để sửa."
            : "Không tìm thấy dữ liệu cũ trong bộ nhớ đệm (có thể đã quá 7 ngày). Muốn đủ số liệu thì phải quét lại, và lần đó tốn tiền.",
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
