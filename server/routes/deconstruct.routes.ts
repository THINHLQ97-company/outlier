// Bóc cấu trúc bài — "vì sao bài này giữ được người xem" (docs/PRD.md §4 J3).
//
// Phân tích mất 1-3 phút (tải video + gọi model) nên CHẠY NỀN: endpoint trả về
// ngay, client theo dõi bằng GET /api/deconstructions/:id (xem docs/ARCH.md §4b).
import type { Express } from "express";
import { desc, eq } from "drizzle-orm";
import { getDb, isDbConfigured } from "../db/client";
import { deconstructions, radarItems } from "../db/schema";
import { requireAuth, getAuthUser } from "../auth-mw";
import { deconstruct } from "../services/deconstruct";
import { assertPublicUrl } from "../services/brand-ingest";
import { isActiveAdmin } from "./studio.routes";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function dbDown(res: any): boolean {
  if (!isDbConfigured()) {
    res.status(503).json({ error: "Tính năng dữ liệu chưa khả dụng (thiếu DATABASE_URL)." });
    return true;
  }
  return false;
}

/** Phân tích chạy nền; lỗi ghi thẳng vào bản ghi vì request đã trả về rồi. */
export async function runDeconstructInBackground(id: string, url: string) {
  try {
    await getDb().update(deconstructions).set({ status: "analyzing", updatedAt: new Date() }).where(eq(deconstructions.id, id));

    const r = await deconstruct(url);
    const hasContent = !!(r.structure.hook3s || r.structure.formula || (r.structure.retentionBeats || []).length);

    await getDb().update(deconstructions).set({
      status: hasContent ? "ready" : "error",
      title: r.info.title ?? null,
      platform: r.info.platform ?? null,
      durationSec: r.info.durationSec ?? null,
      transcript: r.transcript ?? null,
      structure: hasContent ? (r.structure as any) : null,
      analysisMode: r.analysisMode,
      analyzedBy: "gemini",
      // `dropped` = các mốc bị loại vì không đối chiếu được với độ dài video.
      // Giữ lại để người dùng biết vì sao kết quả thiếu, thay vì im lặng.
      errorMessage: [r.warning, ...(r.dropped || [])].filter(Boolean).join(" · ").slice(0, 500) || null,
      updatedAt: new Date(),
    }).where(eq(deconstructions.id, id));
  } catch (e: any) {
    console.error("deconstruct (nền):", e?.message || e);
    await getDb().update(deconstructions)
      .set({ status: "error", errorMessage: String(e?.message || e).slice(0, 400), updatedAt: new Date() })
      .where(eq(deconstructions.id, id))
      .catch(() => {});
  }
}

export function registerDeconstructRoutes(app: Express) {
  app.get("/api/deconstructions", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const username = getAuthUser(req)!;
    try {
      const rows = await getDb().select().from(deconstructions)
        .where(eq(deconstructions.owner, username))
        .orderBy(desc(deconstructions.createdAt)).limit(50);
      res.json(rows);
    } catch (e: any) {
      console.error("deconstruct list:", e?.message || e);
      res.status(500).json({ error: "Không tải được danh sách." });
    }
  });

  app.get("/api/deconstructions/:id", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "Mã không hợp lệ." });
    try {
      const [row] = await getDb().select().from(deconstructions).where(eq(deconstructions.id, id));
      if (!row) return res.status(404).json({ error: "Không tìm thấy bản phân tích." });
      const username = getAuthUser(req)!;
      if (row.owner !== username && !(await isActiveAdmin(username))) {
        return res.status(403).json({ error: "Không có quyền xem bản phân tích này." });
      }
      res.json(row);
    } catch (e: any) {
      console.error("deconstruct get:", e?.message || e);
      res.status(500).json({ error: "Không tải được bản phân tích." });
    }
  });

  // ===== Bắt đầu phân tích =====
  app.post("/api/deconstructions", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const username = getAuthUser(req)!;
    const rawUrl = String(req.body?.url || "").trim();
    const radarItemId = UUID_RE.test(req.body?.radarItemId || "") ? req.body.radarItemId : null;

    let url = rawUrl;
    try {
      // Cho phép chỉ đưa mã bài trong Radar, tự lấy link ra.
      if (!url && radarItemId) {
        const [item] = await getDb().select().from(radarItems).where(eq(radarItems.id, radarItemId));
        if (!item) return res.status(404).json({ error: "Không tìm thấy bài trong kết quả quét." });
        url = item.url;
      }
      if (!url) return res.status(400).json({ error: "Dán link bài muốn phân tích." });
      assertPublicUrl(url); // chặn link trỏ vào mạng nội bộ
    } catch (e: any) {
      return res.status(400).json({ error: e?.message || "Link không hợp lệ." });
    }

    try {
      const [row] = await getDb().insert(deconstructions)
        .values({ owner: username, sourceUrl: url, radarItemId, status: "downloading" })
        .returning();

      res.status(201).json({
        ...row, polling: true,
        message: "Đang phân tích bài này. Việc này mất khoảng 1-3 phút.",
      });

      void runDeconstructInBackground(row.id, url);
    } catch (e: any) {
      console.error("deconstruct create:", e?.message || e);
      res.status(500).json({ error: "Không bắt đầu phân tích được." });
    }
  });

  app.delete("/api/deconstructions/:id", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "Mã không hợp lệ." });
    try {
      const [row] = await getDb().select().from(deconstructions).where(eq(deconstructions.id, id));
      if (!row) return res.status(404).json({ error: "Không tìm thấy bản phân tích." });
      const username = getAuthUser(req)!;
      if (row.owner !== username && !(await isActiveAdmin(username))) {
        return res.status(403).json({ error: "Không có quyền xoá." });
      }
      await getDb().delete(deconstructions).where(eq(deconstructions.id, id));
      res.json({ success: true });
    } catch (e: any) {
      console.error("deconstruct delete:", e?.message || e);
      res.status(500).json({ error: "Không xoá được." });
    }
  });
}

/** Dùng chung cho MCP (server/routes/mcp-signals.routes.ts) — không nhân bản logic. */
export const runDeconstructForMcp = runDeconstructInBackground;
