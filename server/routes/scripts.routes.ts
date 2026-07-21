// DỊCH routes (FR3.x) — sinh 3 phương án kịch bản/tín hiệu, chọn 1 phương án.
import type { Express } from "express";
import { desc, eq } from "drizzle-orm";
import { getDb, isDbConfigured } from "../db/client";
import { scripts, signals } from "../db/schema";
import { requireAuth, getAuthUser } from "../auth-mw";
import { generateScriptVariants } from "../services/social-proxy";
import type { AxisKey } from "../../shared/engine-data";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function dbDown(res: any): boolean {
  if (!isDbConfigured()) {
    res.status(503).json({ error: "Tính năng dữ liệu chưa khả dụng (thiếu DATABASE_URL)." });
    return true;
  }
  return false;
}

export function registerScriptRoutes(app: Express) {
  app.get("/api/scripts", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { signalId } = req.query;
    try {
      const db = getDb();
      const rows =
        typeof signalId === "string" && UUID_RE.test(signalId)
          ? await db.select().from(scripts).where(eq(scripts.signalId, signalId)).orderBy(desc(scripts.createdAt))
          : await db.select().from(scripts).orderBy(desc(scripts.createdAt));
      res.json(rows);
    } catch (e: any) {
      console.error("list scripts:", e?.message || e);
      res.status(500).json({ error: "Lỗi tải danh sách kịch bản." });
    }
  });

  app.get("/api/scripts/:id", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "ID không hợp lệ." });
    try {
      const [row] = await getDb().select().from(scripts).where(eq(scripts.id, id));
      if (!row) return res.status(404).json({ error: "Không tìm thấy kịch bản." });
      res.json(row);
    } catch (e: any) {
      console.error("get script:", e?.message || e);
      res.status(500).json({ error: "Lỗi tải kịch bản." });
    }
  });

  // FR3.1/3.2 — sinh 3 phương án. Server fallback template demo nếu thiếu
  // SOCIAL_BACKEND_URL (xem server/services/social-proxy.ts), scripts.isDemo
  // đánh dấu rõ cho UI hiển thị cảnh báo.
  app.post("/api/scripts/generate", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const user = getAuthUser(req)!;
    const { signalId, truc, formatMeme } = req.body || {};
    if (!signalId || !UUID_RE.test(signalId)) return res.status(400).json({ error: "signalId không hợp lệ." });
    if (!truc || !formatMeme) return res.status(400).json({ error: "Thiếu trục hoặc format meme." });

    try {
      const db = getDb();
      const [signal] = await db.select().from(signals).where(eq(signals.id, signalId));
      if (!signal) return res.status(404).json({ error: "Không tìm thấy tín hiệu." });

      const result = await generateScriptVariants({
        signalSummary: `${signal.title}. ${signal.rawSummary}`,
        truc: truc as AxisKey,
        formatMeme,
      });

      const [row] = await db
        .insert(scripts)
        .values({
          signalId,
          truc,
          formatMeme,
          contentJson: result.variants,
          selectedVariant: null,
          isDemo: result.isDemo,
          createdBy: user,
        })
        .returning();

      res.status(201).json({ ...row, warning: result.warning });
    } catch (e: any) {
      console.error("generate script:", e?.message || e);
      res.status(500).json({ error: "Sinh kịch bản thất bại." });
    }
  });

  // FR3.3 — chọn 1 trong 3 phương án.
  app.post("/api/scripts/:id/select", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "ID không hợp lệ." });
    const { variantIndex } = req.body || {};
    if (typeof variantIndex !== "number" || variantIndex < 0 || variantIndex > 2) {
      return res.status(400).json({ error: "variantIndex phải là 0, 1 hoặc 2." });
    }
    try {
      const db = getDb();
      const [existing] = await db.select().from(scripts).where(eq(scripts.id, id));
      if (!existing) return res.status(404).json({ error: "Không tìm thấy kịch bản." });
      if (!existing.contentJson[variantIndex]) {
        return res.status(400).json({ error: "Phương án không tồn tại." });
      }
      const [row] = await db.update(scripts).set({ selectedVariant: variantIndex }).where(eq(scripts.id, id)).returning();
      res.json(row);
    } catch (e: any) {
      console.error("select script variant:", e?.message || e);
      res.status(500).json({ error: "Chọn phương án thất bại." });
    }
  });
}
