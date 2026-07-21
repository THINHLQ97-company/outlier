// THU + LỌC routes (FR1.x, FR2.x). List/manual-create/sync signals, suggest +
// confirm rubric scoring, read/update the active rubric version.
import type { Express } from "express";
import { and, desc, eq, gte } from "drizzle-orm";
import { getDb, isDbConfigured } from "../db/client";
import { signals, rubricVersions } from "../db/schema";
import { requireAuth, getAuthUser } from "../auth-mw";
import { fetchMarketRadarSignals } from "../services/market-radar.client";
import { fetchGroupInsightsSignals } from "../services/group-insights.client";
import { suggestScoreForSignal, suggestScoreWithLLM, computeSignalStatus } from "../services/rubric-scoring";
import { RUBRIC_DEFAULT_WEIGHTS, RUBRIC_DEFAULT_THRESHOLDS } from "../../shared/engine-data";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RETENTION_DAYS = 14; // FR1.2 — chỉ giữ tín hiệu 14 ngày gần nhất

function dbDown(res: any): boolean {
  if (!isDbConfigured()) {
    res.status(503).json({ error: "Tính năng dữ liệu chưa khả dụng (thiếu DATABASE_URL)." });
    return true;
  }
  return false;
}

async function getActiveRubricRow() {
  const db = getDb();
  const [active] = await db.select().from(rubricVersions).where(eq(rubricVersions.isActive, true)).orderBy(desc(rubricVersions.createdAt));
  if (active) return active;
  // Không có version nào active (DB trống trước khi seed) — trả về default in-memory,
  // không throw để signals vẫn xem/chấm điểm được (server/db/seed.ts tạo version thật).
  return {
    id: null as any,
    weightsJson: RUBRIC_DEFAULT_WEIGHTS,
    thresholdsJson: RUBRIC_DEFAULT_THRESHOLDS,
    note: "(default — chưa seed rubric_versions)",
    isActive: true,
    createdAt: new Date(),
    createdBy: "system-default",
  };
}

export function registerSignalRoutes(app: Express) {
  // FR1.2 — list, filter theo status, chỉ trong 14 ngày (đối với published_date).
  app.get("/api/signals", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { status } = req.query;
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    try {
      const conditions = [gte(signals.publishedDate, cutoff)];
      if (typeof status === "string" && status) conditions.push(eq(signals.status, status));
      const rows = await getDb()
        .select()
        .from(signals)
        .where(and(...conditions))
        .orderBy(desc(signals.publishedDate));
      res.json(rows);
    } catch (e: any) {
      console.error("list signals:", e?.message || e);
      res.status(500).json({ error: "Lỗi tải danh sách tín hiệu." });
    }
  });

  // FR1.3 — form nhập tay (P0 hạ tầng / lịch mùa vụ / thủ công khác).
  app.post("/api/signals", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const user = getAuthUser(req)!;
    const { title, rawSummary, sourceUrl, truc, publishedDate } = req.body || {};
    if (!title || !rawSummary) {
      return res.status(400).json({ error: "Thiếu tiêu đề hoặc tóm tắt tín hiệu." });
    }
    try {
      const [row] = await getDb()
        .insert(signals)
        .values({
          source: "manual",
          radar: null,
          truc: typeof truc === "string" ? truc : null,
          title: String(title).trim(),
          rawSummary: String(rawSummary).trim(),
          sourceUrl: typeof sourceUrl === "string" ? sourceUrl : null,
          publishedDate: publishedDate ? new Date(publishedDate) : new Date(),
          status: "new",
          scoreJson: {},
          createdBy: user,
        })
        .returning();
      res.status(201).json(row);
    } catch (e: any) {
      console.error("create signal:", e?.message || e);
      res.status(500).json({ error: "Lỗi lưu tín hiệu." });
    }
  });

  // FR1.1 — THU: quét Market Radar + Group Insights MCP (fallback demo nếu
  // thiếu token, KHÔNG throw — xem server/services/*.client.ts).
  app.post("/api/signals/sync", requireAuth, async (_req, res) => {
    if (dbDown(res)) return;
    try {
      const [marketRadar, groupInsights] = await Promise.all([
        fetchMarketRadarSignals(),
        fetchGroupInsightsSignals(),
      ]);
      const warnings = [marketRadar.warning, groupInsights.warning].filter(Boolean) as string[];
      const raw = [...marketRadar.signals, ...groupInsights.signals];

      const db = getDb();
      let inserted = 0;
      for (const s of raw) {
        // Best-effort de-dupe by (title, radar) — v1 không có unique constraint,
        // tránh insert trùng khi sync nhiều lần trong ngày.
        const existing = await db
          .select({ id: signals.id })
          .from(signals)
          .where(and(eq(signals.title, s.title), eq(signals.radar, s.radar)));
        if (existing.length > 0) continue;

        await db.insert(signals).values({
          source: s.source,
          radar: s.radar,
          truc: null,
          title: s.title,
          rawSummary: s.rawSummary,
          sourceUrl: s.sourceUrl,
          publishedDate: new Date(s.publishedDate),
          status: "new",
          scoreJson: {},
        });
        inserted++;
      }
      res.json({ inserted, warnings });
    } catch (e: any) {
      console.error("sync signals:", e?.message || e);
      res.status(500).json({ error: "Quét tín hiệu thất bại." });
    }
  });

  // FR2.3 — gợi ý điểm, KHÔNG lưu. Ưu tiên LLM (Gemini "hiểu" nội dung) khi có
  // GEMINI_API_KEY; lỗi/thiếu key → fallback rule-based (đếm từ khóa glossary).
  // Người vận hành LUÔN rà/sửa tay trước khi chốt (/score).
  app.get("/api/signals/:id/suggest-score", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "ID không hợp lệ." });
    try {
      const [signal] = await getDb().select().from(signals).where(eq(signals.id, id));
      if (!signal) return res.status(404).json({ error: "Không tìm thấy tín hiệu." });

      const scoreInput = {
        title: signal.title,
        rawSummary: signal.rawSummary,
        publishedDate: signal.publishedDate as any,
        truc: signal.truc,
      };

      if (process.env.GEMINI_API_KEY) {
        try {
          return res.json(await suggestScoreWithLLM(scoreInput));
        } catch (e: any) {
          console.warn("[suggest-score] LLM thất bại, fallback rule-based:", e?.message || e);
        }
      }
      res.json(suggestScoreForSignal(scoreInput));
    } catch (e: any) {
      console.error("suggest-score:", e?.message || e);
      res.status(500).json({ error: "Không gợi ý được điểm." });
    }
  });

  // FR2.1/2.2 — chốt điểm (người vận hành có thể đã sửa tay), server tự route
  // status theo ngưỡng rubric active. Dính nhóm ⛔ → loại thẳng bất kể điểm khác.
  app.post("/api/signals/:id/score", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const user = getAuthUser(req)!;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "ID không hợp lệ." });
    const { do_nong, do_cham, do_hop_truc, tuoi_tho, do_an_toan, dinh_nhom_cam } = req.body || {};
    const criteria = [do_nong, do_cham, do_hop_truc, tuoi_tho, do_an_toan];
    if (criteria.some((v) => typeof v !== "number" || v < 1 || v > 5)) {
      return res.status(400).json({ error: "Điểm 5 tiêu chí phải là số 1-5." });
    }
    try {
      const db = getDb();
      const [signal] = await db.select().from(signals).where(eq(signals.id, id));
      if (!signal) return res.status(404).json({ error: "Không tìm thấy tín hiệu." });

      const rubric = await getActiveRubricRow();
      const thresholds = rubric.thresholdsJson as { queue_min: number; idea_bank_min: number };
      const { status, total } = computeSignalStatus(
        { do_nong, do_cham, do_hop_truc, tuoi_tho, dinh_nhom_cam: !!dinh_nhom_cam },
        thresholds
      );

      const scoreJson = {
        do_nong,
        do_cham,
        do_hop_truc,
        tuoi_tho,
        do_an_toan,
        total,
        dinh_nhom_cam: !!dinh_nhom_cam,
        scored_by: user,
        scored_at: new Date().toISOString(),
        rubric_version_id: rubric.id,
      };

      const [row] = await db.update(signals).set({ scoreJson, status }).where(eq(signals.id, id)).returning();
      res.json(row);
    } catch (e: any) {
      console.error("score signal:", e?.message || e);
      res.status(500).json({ error: "Chấm điểm thất bại." });
    }
  });

  // FR2.4 — rubric hiện hành.
  app.get("/api/rubric", requireAuth, async (_req, res) => {
    if (dbDown(res)) return;
    try {
      const rubric = await getActiveRubricRow();
      res.json(rubric);
    } catch (e: any) {
      console.error("get rubric:", e?.message || e);
      res.status(500).json({ error: "Không tải được rubric." });
    }
  });

  // FR2.4 — tạo version mới (ghi lịch sử: version cũ tắt isActive, không xoá).
  app.post("/api/rubric", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const user = getAuthUser(req)!;
    const { weightsJson, thresholdsJson, note } = req.body || {};
    if (!weightsJson || !thresholdsJson) {
      return res.status(400).json({ error: "Thiếu weightsJson hoặc thresholdsJson." });
    }
    try {
      const db = getDb();
      await db.update(rubricVersions).set({ isActive: false }).where(eq(rubricVersions.isActive, true));
      const [row] = await db
        .insert(rubricVersions)
        .values({ weightsJson, thresholdsJson, note: note || null, isActive: true, createdBy: user })
        .returning();
      res.status(201).json(row);
    } catch (e: any) {
      console.error("update rubric:", e?.message || e);
      res.status(500).json({ error: "Cập nhật rubric thất bại." });
    }
  });
}
