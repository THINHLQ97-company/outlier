// VẼ routes (FR4.x) — sinh 2 biến thể ảnh không chữ, chọn ảnh, lưu overlay +
// export ảnh cuối, gửi vào hàng đợi DUYỆT. Posts.status="draft" cho tới khi
// /submit chuyển sang "cho_duyet" (Step 6 sở hữu phần kanban/checklist).
import type { Express } from "express";
import { eq } from "drizzle-orm";
import { getDb, isDbConfigured } from "../db/client";
import { posts, scripts, characters as charactersTable } from "../db/schema";
import { requireAuth } from "../auth-mw";
import { generateImageVariants } from "../services/social-proxy";
import { AXES, STYLE_PROMPT, WATERMARK_BRANDS, type AxisKey } from "../../shared/engine-data";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function dbDown(res: any): boolean {
  if (!isDbConfigured()) {
    res.status(503).json({ error: "Tính năng dữ liệu chưa khả dụng (thiếu DATABASE_URL)." });
    return true;
  }
  return false;
}

export function registerImageRoutes(app: Express) {
  // FR4.1/4.2 — ghép style chung + mô tả nhân vật (character reference
  // library) + mô tả khung từ kịch bản đã chọn → sinh 2 biến thể ảnh KHÔNG chữ.
  app.post("/api/images/generate", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { scriptId } = req.body || {};
    if (!scriptId || !UUID_RE.test(scriptId)) return res.status(400).json({ error: "scriptId không hợp lệ." });

    try {
      const db = getDb();
      const [script] = await db.select().from(scripts).where(eq(scripts.id, scriptId));
      if (!script) return res.status(404).json({ error: "Không tìm thấy kịch bản." });
      if (script.selectedVariant === null || script.selectedVariant === undefined) {
        return res.status(400).json({ error: "Kịch bản chưa chọn phương án (FR3.3)." });
      }
      const variant = script.contentJson[script.selectedVariant];
      if (!variant) return res.status(400).json({ error: "Phương án đã chọn không hợp lệ." });

      const axis = AXES[script.truc as AxisKey];
      const leadCharacterNames: readonly string[] = axis?.leadCharacters ?? [];
      const allChars = await db.select().from(charactersTable);
      const leadChars = allChars.filter((c) => leadCharacterNames.includes(c.name));
      const characterNames = (leadChars.length ? leadChars : allChars).map((c) => c.name);
      const characterPrompts = (leadChars.length ? leadChars : allChars).map((c) => `${c.name}: ${c.promptDescription}`).join("\n");

      const panelsText = variant.panels.map((p: string, i: number) => `Khung ${i + 1}: ${p}`).join("\n");

      const result = await generateImageVariants({
        styleSummary: `${STYLE_PROMPT}\n\n${characterPrompts}`,
        panelsText,
        characterNames,
      });

      const [row] = await db
        .insert(posts)
        .values({
          scriptId,
          imageVariants: result.images,
          selectedImageUrl: null,
          overlayJson: { textBoxes: [], watermarkBrand: WATERMARK_BRANDS[script.truc as AxisKey] || "MATBAO" },
          caption: variant.caption,
          status: "draft",
        })
        .returning();

      res.status(201).json({ ...row, warning: result.warning });
    } catch (e: any) {
      console.error("generate images:", e?.message || e);
      res.status(500).json({ error: "Sinh ảnh thất bại." });
    }
  });

  app.post("/api/posts/:id/select-image", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "ID không hợp lệ." });
    const { imageUrl } = req.body || {};
    if (typeof imageUrl !== "string" || !imageUrl) return res.status(400).json({ error: "Thiếu imageUrl." });
    try {
      const db = getDb();
      const [existing] = await db.select().from(posts).where(eq(posts.id, id));
      if (!existing) return res.status(404).json({ error: "Không tìm thấy bài." });
      const validUrl = (existing.imageVariants || []).some((v: any) => v.url === imageUrl);
      if (!validUrl) return res.status(400).json({ error: "Ảnh không nằm trong 2 biến thể đã sinh." });
      const [row] = await db.update(posts).set({ selectedImageUrl: imageUrl }).where(eq(posts.id, id)).returning();
      res.json(row);
    } catch (e: any) {
      console.error("select image:", e?.message || e);
      res.status(500).json({ error: "Chọn ảnh thất bại." });
    }
  });

  // FR4.3 — lưu vị trí text box + ảnh PNG cuối (export từ Canvas client-side,
  // gửi lên dạng data URL). Không giới hạn kích thước ngoài body limit 10mb
  // (server.ts) — đủ cho ảnh demo/nội bộ <10 người dùng.
  app.post("/api/posts/:id/overlay", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "ID không hợp lệ." });
    const { overlayJson, finalImageDataUrl, caption } = req.body || {};
    if (!overlayJson || typeof finalImageDataUrl !== "string" || !finalImageDataUrl.startsWith("data:image/")) {
      return res.status(400).json({ error: "Thiếu overlayJson hoặc finalImageDataUrl không hợp lệ." });
    }
    try {
      const db = getDb();
      const [row] = await db
        .update(posts)
        .set({ overlayJson, finalImageUrl: finalImageDataUrl, caption: typeof caption === "string" ? caption : undefined })
        .where(eq(posts.id, id))
        .returning();
      if (!row) return res.status(404).json({ error: "Không tìm thấy bài." });
      res.json(row);
    } catch (e: any) {
      console.error("save overlay:", e?.message || e);
      res.status(500).json({ error: "Lưu overlay thất bại." });
    }
  });

  // Đưa bài vào kanban "Chờ duyệt" (FR5.1) — kết thúc bước VẼ.
  app.post("/api/posts/:id/submit", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "ID không hợp lệ." });
    try {
      const db = getDb();
      const [existing] = await db.select().from(posts).where(eq(posts.id, id));
      if (!existing) return res.status(404).json({ error: "Không tìm thấy bài." });
      if (!existing.finalImageUrl) return res.status(400).json({ error: "Chưa có ảnh cuối (hoàn tất text-overlay trước)." });
      const [row] = await db.update(posts).set({ status: "cho_duyet" }).where(eq(posts.id, id)).returning();
      res.json(row);
    } catch (e: any) {
      console.error("submit post:", e?.message || e);
      res.status(500).json({ error: "Gửi duyệt thất bại." });
    }
  });
}
