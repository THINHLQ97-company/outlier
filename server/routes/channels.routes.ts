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
export async function refreshChannelInBackground(channelId: string, limit = DEFAULT_LIMIT) {
  const db = getDb();
  try {
    const [chan] = await db.select().from(watchedChannels).where(eq(watchedChannels.id, channelId));
    if (!chan) return;

    await db.update(watchedChannels)
      .set({ scanStatus: "scanning", errorMessage: null, updatedAt: new Date() })
      .where(eq(watchedChannels.id, channelId));

    let r = await scanCandidates(chan.platform, chan.channelUrl, "competitor", limit);

    // yt-dlp không lấy được kênh TikTok từ link @user. Nếu người dùng đã bật
    // dịch vụ có phí thì đi đường Apify — quét profile và lấy luôn số liệu đầy đủ.
    if (r.candidates.length === 0 && chan.useApify && isApifyConfigured()) {
      const viaApify = await scanChannelViaApify(chan.platform, chan.channelUrl, limit);
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
    await db.update(watchedChannels).set({
      scanStatus: "idle", errorMessage: null,
      lastScanAt: new Date(), lastJobId: job.id, lastNewCount: newKeys.length,
      scanCount: (chan.scanCount || 0) + 1,
      channelKey: chan.channelKey ?? first?.channelKey ?? null,
      channelName: chan.channelName ?? first?.channelName ?? null,
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
    title: m.title, coverUrl: undefined, durationSec: undefined,
    // Apify chỉ dùng cho TikTok/Instagram ở đây, đều là video.
    contentKind: "video" as const,
    publishedAt: m.publishedAt,
    channelKey: m.channelKey, channelName: m.channelName,
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
