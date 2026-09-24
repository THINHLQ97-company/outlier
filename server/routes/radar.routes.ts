// Radar — tìm bài đang bật lên trong ngách (docs/PRD.md §4 J2).
//
// Hai bước TÁCH RỜI, cố ý:
//   POST /api/radar          → QUÉT, miễn phí, chạy ngay.
//   POST /api/radar/:id/enrich → BỔ SUNG SỐ LIỆU qua Apify, TỐN TIỀN.
// Tách ra để việc tiêu tiền luôn là hành động có chủ ý của người dùng, không bao
// giờ tự động xảy ra sau một cú bấm "tìm kiếm".
import type { Express } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, isDbConfigured } from "../db/client";
import { radarJobs, radarItems, channelBaselines } from "../db/schema";
import { requireAuth, getAuthUser } from "../auth-mw";
import { scanCandidates, type ScanCandidate } from "../services/radar-scan";
import { enrichMetrics, estimateCostUsd, isApifyConfigured, resultsUsedToday } from "../services/apify";
import { scoreOutperform, median, MIN_SAMPLE_FOR_BASELINE } from "../services/outperform";
import { isActiveAdmin } from "./studio.routes";
import { toCsv, safeFilename } from "../services/export-csv";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLATFORMS = ["douyin", "tiktok", "youtube", "instagram"];

function dbDown(res: any): boolean {
  if (!isDbConfigured()) {
    res.status(503).json({ error: "Tính năng dữ liệu chưa khả dụng (thiếu DATABASE_URL)." });
    return true;
  }
  return false;
}

/** Cập nhật mốc kênh từ các bài đã biết, rồi trả về map để chấm điểm. */
async function refreshBaselines(items: { channelKey?: string | null; platform: string; views?: number | null; likes?: number | null; followerCount?: number | null; channelName?: string | null }[]) {
  const db = getDb();
  const byChannel = new Map<string, typeof items>();
  for (const it of items) {
    if (!it.channelKey) continue;
    const k = `${it.platform}:${it.channelKey}`;
    if (!byChannel.has(k)) byChannel.set(k, []);
    byChannel.get(k)!.push(it);
  }

  const out = new Map<string, { medianViews: number | null; medianLikes: number | null; sampleSize: number }>();
  for (const [key, group] of byChannel) {
    const [platform, channelKey] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
    const mv = median(group.map((g) => Number(g.views)).filter(Number.isFinite));
    const ml = median(group.map((g) => Number(g.likes)).filter(Number.isFinite));
    const follower = group.find((g) => g.followerCount)?.followerCount ?? null;
    const name = group.find((g) => g.channelName)?.channelName ?? null;

    const [existing] = await db
      .select()
      .from(channelBaselines)
      .where(and(eq(channelBaselines.platform, platform), eq(channelBaselines.channelKey, channelKey)));

    // Gộp với mẫu cũ: giữ mẫu lớn hơn để mốc ổn định dần theo thời gian.
    const sample = Math.max(existing?.sampleSize ?? 0, group.length);
    const medianViews = mv ?? existing?.medianViews ?? null;
    const medianLikes = ml ?? existing?.medianLikes ?? null;

    if (existing) {
      await db.update(channelBaselines)
        .set({ medianViews, medianLikes, sampleSize: sample, followerCount: follower ?? existing.followerCount, channelName: name ?? existing.channelName, updatedAt: new Date() })
        .where(eq(channelBaselines.id, existing.id));
    } else {
      await db.insert(channelBaselines).values({ platform, channelKey, channelName: name, followerCount: follower, medianViews, medianLikes, sampleSize: sample });
    }
    out.set(key, { medianViews, medianLikes, sampleSize: sample });
  }
  return out;
}

/** Chấm điểm và ghi lại vào radar_items. Dùng chung với channels.routes. */
export async function rescoreRadarJob(jobId: string) {
  const db = getDb();
  const rows = await db.select().from(radarItems).where(eq(radarItems.jobId, jobId));
  const baselines = await refreshBaselines(rows);

  // Mốc tạm của chính lần quét — dùng khi chưa có mốc riêng của kênh, để vẫn xếp
  // được thứ tự thay vì mọi bài cùng điểm.
  const session = {
    medianViews: median(rows.map((r) => Number(r.views)).filter(Number.isFinite)),
    medianLikes: median(rows.map((r) => Number(r.likes)).filter(Number.isFinite)),
  };

  for (const r of rows) {
    const base = r.channelKey ? baselines.get(`${r.platform}:${r.channelKey}`) ?? null : null;
    const res = scoreOutperform(
      { views: r.views, likes: r.likes, followerCount: r.followerCount, publishedAt: r.publishedAt },
      base,
      undefined,
      new Date(),
      session,
    );
    await db.update(radarItems)
      .set({
        outperformScore: Math.round(res.score * 1000),
        confidence: res.confidence,
        scoreBreakdown: res.breakdown as any,
      })
      .where(eq(radarItems.id, r.id));
  }
  return rows.length;
}

/**
 * Quét chạy nền. Mọi lỗi được ghi vào chính bản ghi phiên quét để người dùng
 * nhìn thấy, vì lúc này request đã trả về rồi — không còn chỗ nào để báo lỗi.
 */
async function runScanInBackground(
  jobId: string,
  platforms: string[],
  query: string,
  queryKind: "keyword" | "competitor",
  limit: number,
) {
  const warnings: string[] = [];
  const all: ScanCandidate[] = [];
  try {
    for (const p of platforms) {
      const r = await scanCandidates(p, query, queryKind, limit);
      if (r.warning) warnings.push(`${p}: ${r.warning}`);
      all.push(...r.candidates);

      // Ghi kết quả + cập nhật số đếm NGAY sau mỗi nền tảng, thay vì đợi xong
      // hết. Người dùng đang theo dõi sẽ thấy con số nhích dần thay vì đứng im
      // suốt cả phút khi quét nhiều nền tảng.
      if (r.candidates.length > 0) {
        await getDb().insert(radarItems).values(r.candidates.map((c) => ({
          jobId, platform: c.platform, itemKey: c.itemKey, url: c.url,
          title: c.title ?? null, coverUrl: c.coverUrl ?? null, durationSec: c.durationSec ?? null,
          publishedAt: c.publishedAt ? new Date(c.publishedAt) : null,
          channelKey: c.channelKey ?? null, channelName: c.channelName ?? null,
          followerCount: c.followerCount ?? null,
          views: c.views ?? null, likes: c.likes ?? null,
          contentKind: c.contentKind || "unknown",
          metricsSource: "scan",
        })));
      }
      await getDb().update(radarJobs)
        .set({ scannedCount: all.length, updatedAt: new Date() })
        .where(eq(radarJobs.id, jobId));
    }

    // Chấm điểm một lần ở cuối: mốc tham chiếu của phiên quét cần TOÀN BỘ dữ
    // liệu mới tính đúng, chấm sớm từng phần sẽ ra điểm lệch rồi phải sửa lại.
    if (all.length > 0) await rescoreRadarJob(jobId);

    await getDb().update(radarJobs)
      .set({ status: "ready", scannedCount: all.length, errorMessage: warnings.join(" · ") || null, updatedAt: new Date() })
      .where(eq(radarJobs.id, jobId));
  } catch (e: any) {
    console.error("radar scan (nền):", e?.message || e);
    await getDb().update(radarJobs)
      .set({ status: "error", errorMessage: String(e?.message || e).slice(0, 300), updatedAt: new Date() })
      .where(eq(radarJobs.id, jobId))
      .catch(() => {});
  }
}

/** Bổ sung số liệu chạy nền — xem lý do ở runScanInBackground. */
async function runEnrichInBackground(jobId: string, candidates: any[], previousEnriched: number) {
  try {
    const byPlatform = new Map<string, any[]>();
    for (const c of candidates) {
      if (!byPlatform.has(c.platform)) byPlatform.set(c.platform, []);
      byPlatform.get(c.platform)!.push(c);
    }

    const warnings: string[] = [];
    let enriched = 0;
    for (const [platform, group] of byPlatform) {
      const out = await enrichMetrics(platform, group.map((g) => g.url));
      if (out.warning) warnings.push(out.warning);
      const byUrl = new Map(out.metrics.map((m) => [m.url, m]));
      for (const row of group) {
        const m = byUrl.get(row.url);
        if (!m) continue;
        await getDb().update(radarItems).set({
          views: m.views ?? row.views, likes: m.likes ?? row.likes,
          comments: m.comments ?? row.comments, shares: m.shares ?? row.shares,
          followerCount: m.followerCount ?? row.followerCount,
          channelKey: m.channelKey ?? row.channelKey, channelName: m.channelName ?? row.channelName,
          publishedAt: m.publishedAt ? new Date(m.publishedAt) : row.publishedAt,
          metricsSource: "apify",
        }).where(eq(radarItems.id, row.id));
        enriched += 1;
      }
    }

    await rescoreRadarJob(jobId);
    await getDb().update(radarJobs)
      .set({
        status: "ready",
        enrichedCount: previousEnriched + enriched,
        errorMessage: warnings.join(" · ") || null,
        updatedAt: new Date(),
      })
      .where(eq(radarJobs.id, jobId));
  } catch (e: any) {
    console.error("radar enrich (nền):", e?.message || e);
    await getDb().update(radarJobs)
      .set({ status: "ready", errorMessage: `Bổ sung số liệu lỗi: ${String(e?.message || e).slice(0, 200)}`, updatedAt: new Date() })
      .where(eq(radarJobs.id, jobId))
      .catch(() => {});
  }
}

export function registerRadarRoutes(app: Express) {
  // ===== Danh sách phiên quét =====
  app.get("/api/radar", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const username = getAuthUser(req)!;
    try {
      const rows = await getDb().select().from(radarJobs).where(eq(radarJobs.owner, username)).orderBy(desc(radarJobs.createdAt)).limit(50);
      res.json(rows);
    } catch (e: any) {
      console.error("radar list:", e?.message || e);
      res.status(500).json({ error: "Không tải được danh sách phiên quét." });
    }
  });

  // ===== QUÉT (miễn phí) =====
  app.post("/api/radar", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const username = getAuthUser(req)!;
    const query = String(req.body?.query || "").trim();
    const queryKind = req.body?.queryKind === "competitor" ? "competitor" : "keyword";
    const platforms: string[] = Array.isArray(req.body?.platforms)
      ? req.body.platforms.filter((p: any) => PLATFORMS.includes(p))
      : ["youtube"];
    const limit = Math.min(Math.max(1, Number(req.body?.limit) || 30), 100);

    if (!query) return res.status(400).json({ error: "Nhập từ khoá ngách hoặc link đối thủ muốn soi." });
    if (platforms.length === 0) return res.status(400).json({ error: "Chọn ít nhất một nền tảng." });

    let job;
    try {
      [job] = await getDb().insert(radarJobs).values({
        owner: username, query, queryKind, platforms, status: "scanning",
        brandId: UUID_RE.test(req.body?.brandId || "") ? req.body.brandId : null,
      }).returning();
    } catch (e: any) {
      console.error("radar create:", e?.message || e);
      return res.status(500).json({ error: "Không tạo được phiên quét." });
    }

    // Trả về NGAY với status="scanning"; việc quét chạy nền.
    // Quét mất 30-90 giây — giữ request mở lâu như vậy sẽ bị proxy (Traefik/
    // Coolify) ngắt giữa chừng trong môi trường thật. Client theo dõi tiến độ
    // bằng cách gọi lại GET /api/radar/:id cho tới khi status khác "scanning".
    res.status(201).json({
      ...job,
      polling: true,
      message: "Đã bắt đầu quét. Việc này mất khoảng 30-90 giây.",
    });

    void runScanInBackground(job.id, platforms, query, queryKind as any, limit);
  });

  // ===== Kết quả một phiên, xếp theo outperform =====
  app.get("/api/radar/:id", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "Mã phiên quét không hợp lệ." });
    try {
      const [job] = await getDb().select().from(radarJobs).where(eq(radarJobs.id, id));
      if (!job) return res.status(404).json({ error: "Không tìm thấy phiên quét." });
      const username = getAuthUser(req)!;
      if (job.owner !== username && !(await isActiveAdmin(username))) {
        return res.status(403).json({ error: "Không có quyền xem phiên quét này." });
      }
      const rows = await getDb().select().from(radarItems).where(eq(radarItems.jobId, id))
        .orderBy(desc(radarItems.outperformScore)).limit(200);

      // Nhận định tính lúc đọc chứ không lưu: quy tắc còn đang chỉnh, lưu lại
      // thì kết quả cũ mang quy tắc cũ mà không ai biết.
      const { judgeContent, isRecommended } = await import("../services/content-verdict");
      const baselines = await getDb().select().from(channelBaselines);
      const sampleByChannel = new Map(baselines.map((b) => [b.channelKey, b.sampleSize ?? 0]));

      const items = rows.map((r) => {
        const verdict = judgeContent({
          outperformScore: r.outperformScore != null ? r.outperformScore / 100 : null,
          baselineSample: sampleByChannel.get(r.channelKey) ?? 0,
          likes: r.likes,
          comments: r.comments,
          shares: r.shares,
          views: r.views,
          publishedAt: r.publishedAt,
          textLength: r.title?.length ?? null,
          confidence: (r.confidence as any) ?? undefined,
        });
        return { ...r, verdict };
      });

      // Bài đáng chú ý lên đầu, còn lại giữ nguyên thứ tự theo điểm — không bài
      // nào bị loại khỏi danh sách.
      items.sort((a, b) => {
        const ra = isRecommended(a.verdict.level) ? 1 : 0;
        const rb = isRecommended(b.verdict.level) ? 1 : 0;
        if (ra !== rb) return rb - ra;
        return (b.outperformScore ?? 0) - (a.outperformScore ?? 0);
      });

      res.json({
        ...job,
        items,
        minSampleForBaseline: MIN_SAMPLE_FOR_BASELINE,
        recommendedCount: items.filter((i) => isRecommended(i.verdict.level)).length,
      });
    } catch (e: any) {
      console.error("radar get:", e?.message || e);
      res.status(500).json({ error: "Không tải được kết quả." });
    }
  });

  // ===== Ước tính chi phí TRƯỚC khi bổ sung số liệu =====
  app.get("/api/radar/:id/enrich-quote", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "Mã phiên quét không hợp lệ." });
    const top = Math.min(Math.max(1, Number(req.query.top) || 10), 50);
    try {
      const rows = await getDb().select().from(radarItems)
        .where(and(eq(radarItems.jobId, id), eq(radarItems.metricsSource, "scan")))
        .orderBy(desc(radarItems.outperformScore)).limit(top);
      res.json({
        count: rows.length,
        estimatedCostUsd: Number(estimateCostUsd(rows.length).toFixed(4)),
        resultsUsedToday: await resultsUsedToday(),
        apifyConfigured: isApifyConfigured(),
      });
    } catch (e: any) {
      console.error("enrich quote:", e?.message || e);
      res.status(500).json({ error: "Không ước tính được chi phí." });
    }
  });

  // ===== BỔ SUNG SỐ LIỆU (tốn tiền — chỉ chạy khi người dùng chủ động gọi) =====
  app.post("/api/radar/:id/enrich", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "Mã phiên quét không hợp lệ." });
    const top = Math.min(Math.max(1, Number(req.body?.top) || 10), 50);
    try {
      const [job] = await getDb().select().from(radarJobs).where(eq(radarJobs.id, id));
      if (!job) return res.status(404).json({ error: "Không tìm thấy phiên quét." });
      const username = getAuthUser(req)!;
      if (job.owner !== username && !(await isActiveAdmin(username))) {
        return res.status(403).json({ error: "Không có quyền thao tác trên phiên quét này." });
      }

      // Chỉ bổ sung cho các bài ĐẦU BẢNG còn thiếu số liệu — đây là chỗ tiết kiệm nhất.
      const candidates = await getDb().select().from(radarItems)
        .where(and(eq(radarItems.jobId, id), eq(radarItems.metricsSource, "scan")))
        .orderBy(desc(radarItems.outperformScore)).limit(top);

      if (candidates.length === 0) {
        return res.json({ enriched: 0, message: "Không còn bài nào cần bổ sung số liệu." });
      }

      await getDb().update(radarJobs).set({ status: "enriching", updatedAt: new Date() }).where(eq(radarJobs.id, id));

      // Trả về ngay, bổ sung số liệu chạy nền (gọi Apify có thể mất vài chục giây).
      res.json({
        ...job, status: "enriching", polling: true,
        willEnrich: candidates.length,
        estimatedCostUsd: Number(estimateCostUsd(candidates.length).toFixed(4)),
        message: "Đang bổ sung số liệu. Việc này mất khoảng 20-60 giây.",
      });

      void runEnrichInBackground(id, candidates, job.enrichedCount || 0);
    } catch (e: any) {
      console.error("radar enrich:", e?.message || e);
      await getDb().update(radarJobs).set({ status: "ready", updatedAt: new Date() }).where(eq(radarJobs.id, id)).catch(() => {});
      res.status(500).json({ error: "Không bổ sung được số liệu." });
    }
  });

  // ===== Xuất kết quả quét ra CSV =====
  app.get("/api/radar/:id/export.csv", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "Mã phiên quét không hợp lệ." });
    try {
      const [job] = await getDb().select().from(radarJobs).where(eq(radarJobs.id, id));
      if (!job) return res.status(404).json({ error: "Không tìm thấy phiên quét." });
      const username = getAuthUser(req)!;
      if (job.owner !== username && !(await isActiveAdmin(username))) {
        return res.status(403).json({ error: "Không có quyền xem phiên quét này." });
      }
      const items = await getDb().select().from(radarItems).where(eq(radarItems.jobId, id))
        .orderBy(desc(radarItems.outperformScore)).limit(500);

      const csv = toCsv(
        ["Điểm (trên 100)", "Độ tin cậy", "Nguồn số liệu", "Tiêu đề", "Kênh", "Người theo dõi",
         "Lượt xem", "Lượt thích", "Bình luận", "Chia sẻ", "Ngày đăng", "Link", "Vì sao được chấm vậy"],
        items.map((r) => {
          const conf = r.confidence === "high" ? "Đáng tin" : r.confidence === "medium" ? "Khá chắc" : "Tham khảo";
          const reasons = ((r.scoreBreakdown as any)?.reasons || []).join(" | ");
          return [
            r.outperformScore == null ? "" : (r.outperformScore / 10).toFixed(1),
            conf,
            r.metricsSource === "apify" ? "Đầy đủ" : "Sơ bộ",
            r.title || "", r.channelName || "", r.followerCount ?? "",
            r.views ?? "", r.likes ?? "", r.comments ?? "", r.shares ?? "",
            r.publishedAt ? new Date(r.publishedAt).toLocaleDateString("vi-VN") : "",
            r.url, reasons,
          ];
        }),
      );
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${safeFilename("radar-" + job.query)}"`);
      res.send(csv);
    } catch (e: any) {
      console.error("radar export:", e?.message || e);
      res.status(500).json({ error: "Không xuất được file." });
    }
  });

  // ===== Xoá phiên quét =====
  app.delete("/api/radar/:id", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "Mã phiên quét không hợp lệ." });
    try {
      const [job] = await getDb().select().from(radarJobs).where(eq(radarJobs.id, id));
      if (!job) return res.status(404).json({ error: "Không tìm thấy phiên quét." });
      const username = getAuthUser(req)!;
      if (job.owner !== username && !(await isActiveAdmin(username))) {
        return res.status(403).json({ error: "Không có quyền xoá phiên quét này." });
      }
      await getDb().delete(radarItems).where(eq(radarItems.jobId, id));
      await getDb().delete(radarJobs).where(eq(radarJobs.id, id));
      res.json({ success: true });
    } catch (e: any) {
      console.error("radar delete:", e?.message || e);
      res.status(500).json({ error: "Không xoá được phiên quét." });
    }
  });
}
