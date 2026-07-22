// VẼ routes — chọn ảnh, lưu overlay + ảnh cuối, vẽ lại 2 biến thể. Bản rework:
// prompt gửi Gemini là JSON CÓ CẤU TRÚC (buildImageGenerationRequest) + phong
// cách lấy từ thư viện styles (phong cách mặc định). Các endpoint pipeline duyệt/
// đăng đã gỡ (xem posts.routes.ts); ở đây chỉ còn phần hậu kỳ ảnh mà cả Studio
// lẫn bài pipeline cũ còn dùng: /regenerate-images, /select-image, /overlay.
import type { Express } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, isDbConfigured } from "../db/client";
import { posts, scripts, characters as charactersTable } from "../db/schema";
import { requireAuth, getAuthUser } from "../auth-mw";
import { generateImageVariants } from "../services/social-proxy";
import { readImageAsInlineData, internalKeyFromUrl, storage, persistDataUrl } from "../storage";
import {
  persistVariantImages,
  deleteInternalVariants,
  normalizeAspectRatio,
  type AspectRatioValue,
} from "../services/image-store";
import { generateStudioVariants, resolveStyle, type StudioParams } from "./studio.routes";
import { buildImageGenerationRequest, type PromptCharacter } from "../services/prompt-builder";
import { AXES, PANEL_LAYOUTS, type AxisKey } from "../../shared/engine-data";

// Pipeline giữ LUẬT BIÊN TẬP fanpage: ≤2 khung (meme viral). Layout suy theo số
// panel của phương án kịch bản.
const layoutFor = (panelCount: number) =>
  (PANEL_LAYOUTS.find((l) => l.key === (panelCount >= 2 ? "2" : "1")) || PANEL_LAYOUTS[0]).instruction;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Chỉ được chỉnh ảnh/overlay khi bài đang ở khâu VẼ (nháp) hoặc quay lại sửa
// thoại — KHÔNG cho đụng bài đã vào kanban duyệt / đã duyệt / đã đăng.
const EDITABLE_STATUSES = ["draft", "sua_thoai"] as const;

function onlyUuids(v: any): string[] {
  return Array.isArray(v) ? v.filter((x) => typeof x === "string" && UUID_RE.test(x)) : [];
}

function dbDown(res: any): boolean {
  if (!isDbConfigured()) {
    res.status(503).json({ error: "Tính năng dữ liệu chưa khả dụng (thiếu DATABASE_URL)." });
    return true;
  }
  return false;
}

// Vẽ lại ảnh cho bài PIPELINE (từ script) — dựng prompt JSON có cấu trúc từ dàn
// nhân vật + phong cách mặc định + mô tả khung. Dùng bởi nhánh pipeline của
// /regenerate-images. `script` phải có selectedVariant hợp lệ (caller kiểm tra).
async function generateAndStoreImageVariants(
  db: any,
  script: any,
  aspectRatio: AspectRatioValue,
  characterIds?: string[]
) {
  const variant = script.contentJson[script.selectedVariant];
  const allChars = await db.select().from(charactersTable);

  let activeChars: any[];
  if (characterIds && characterIds.length) {
    activeChars = allChars.filter((c: any) => characterIds.includes(c.id));
    if (!activeChars.length) activeChars = allChars; // id không khớp → fallback cả bộ
  } else {
    const axis = AXES[script.truc as AxisKey];
    const leadCharacterNames: readonly string[] = axis?.leadCharacters ?? [];
    const leadChars = allChars.filter((c: any) => leadCharacterNames.includes(c.name));
    activeChars = leadChars.length ? leadChars : allChars;
  }

  const characters: PromptCharacter[] = await Promise.all(
    activeChars.map(async (c: any) => ({
      name: c.name,
      personality: c.personality,
      refImage: await readImageAsInlineData(c.referenceImageUrl),
    }))
  );

  const panelsText = variant.panels.map((p: string, i: number) => `Khung ${i + 1}: ${p}`).join("\n");
  const style = await resolveStyle(db, null, script.createdBy || "system"); // phong cách mặc định

  const { promptText, referenceImages } = await buildImageGenerationRequest({
    scene: panelsText,
    characters,
    memeRef: null,
    style,
    dialogue: [],
    layoutInstruction: layoutFor(variant.panels?.length || 1),
    aspectRatio,
    renderDialogue: false,
  });

  const result = await generateImageVariants({
    promptText,
    referenceImages,
    aspectRatio,
    demoLabel: characters.map((c) => c.name).join(", ") || "Pipeline",
  });

  const storedImages = await persistVariantImages(result.images);
  return { storedImages, warning: result.warning };
}

export function registerImageRoutes(app: Express) {
  // Vẽ lại 2 biến thể ảnh (dùng lại tham số đã lưu trong overlayJson). Guard: chỉ
  // khi status ∈ EDITABLE_STATUSES. Xoá ảnh biến thể CŨ sau khi update DB thành công.
  app.post("/api/posts/:id/regenerate-images", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "ID không hợp lệ." });
    try {
      const db = getDb();
      const [existing] = await db.select().from(posts).where(eq(posts.id, id));
      if (!existing) return res.status(404).json({ error: "Không tìm thấy bài." });
      if (!EDITABLE_STATUSES.includes(existing.status as any)) {
        return res.status(409).json({ error: `Bài đang ở trạng thái "${existing.status}", không thể vẽ lại ảnh.` });
      }

      const overlay = (existing.overlayJson as any) || {};
      const aspectRatio = normalizeAspectRatio(overlay?.aspectRatio);

      let storedImages: { url: string; source: "social" | "placeholder" }[];
      let warning: string | undefined;

      if (existing.origin === "studio") {
        // Bài Studio (scriptId null) — vẽ lại từ tham số Studio đã lưu.
        const sp = overlay?.studioParams || {};
        const params: StudioParams = {
          promptText: existing.promptText || "",
          characterIds: onlyUuids(sp.characterIds),
          assetIds: onlyUuids(sp.assetIds),
          styleId: typeof sp.styleId === "string" ? sp.styleId : null,
          dialogue: Array.isArray(sp.dialogue) ? sp.dialogue : [],
          panelLayout: sp.panelLayout,
        };
        const owner = existing.owner || getAuthUser(req)!;
        ({ storedImages, warning } = await generateStudioVariants(db, owner, params, aspectRatio));
      } else {
        const [script] = await db.select().from(scripts).where(eq(scripts.id, existing.scriptId));
        if (!script) return res.status(404).json({ error: "Không tìm thấy kịch bản gốc." });
        if (script.selectedVariant === null || script.selectedVariant === undefined) {
          return res.status(400).json({ error: "Kịch bản chưa chọn phương án (FR3.3)." });
        }
        const variant = script.contentJson[script.selectedVariant];
        if (!variant) return res.status(400).json({ error: "Phương án đã chọn không hợp lệ." });
        ({ storedImages, warning } = await generateAndStoreImageVariants(
          db,
          script,
          aspectRatio,
          onlyUuids(overlay?.characterIds)
        ));
      }

      // Atomic: chỉ update khi status vẫn nằm trong nhóm được sửa (chống race).
      const [row] = await db
        .update(posts)
        .set({ imageVariants: storedImages, selectedImageUrl: null })
        .where(and(eq(posts.id, id), inArray(posts.status, EDITABLE_STATUSES as any)))
        .returning();
      if (!row) {
        await deleteInternalVariants(storedImages);
        return res.status(409).json({ error: "Trạng thái bài vừa thay đổi, thử lại." });
      }
      await deleteInternalVariants(existing.imageVariants as any[]);
      res.json({ ...row, warning });
    } catch (e: any) {
      console.error("regenerate images:", e?.message || e);
      res.status(500).json({ error: "Vẽ lại ảnh thất bại." });
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
      if (!EDITABLE_STATUSES.includes(existing.status as any)) {
        return res.status(409).json({ error: `Bài đang ở trạng thái "${existing.status}", không thể đổi ảnh.` });
      }
      const validUrl = (existing.imageVariants || []).some((v: any) => v.url === imageUrl);
      if (!validUrl) return res.status(400).json({ error: "Ảnh không nằm trong 2 biến thể đã sinh." });
      const [row] = await db
        .update(posts)
        .set({ selectedImageUrl: imageUrl })
        .where(and(eq(posts.id, id), inArray(posts.status, EDITABLE_STATUSES as any)))
        .returning();
      if (!row) return res.status(409).json({ error: "Trạng thái bài vừa thay đổi, thử lại." });
      res.json(row);
    } catch (e: any) {
      console.error("select image:", e?.message || e);
      res.status(500).json({ error: "Chọn ảnh thất bại." });
    }
  });

  // Lưu vị trí text box + ảnh PNG cuối (export từ Canvas client-side, data URL).
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
      const [existing] = await db.select().from(posts).where(eq(posts.id, id));
      if (!existing) return res.status(404).json({ error: "Không tìm thấy bài." });
      if (!EDITABLE_STATUSES.includes(existing.status as any)) {
        return res.status(409).json({ error: `Bài đang ở trạng thái "${existing.status}", không thể lưu overlay.` });
      }

      const finalUrl = (await persistDataUrl("posts", finalImageDataUrl)) || finalImageDataUrl;

      const [row] = await db
        .update(posts)
        .set({ overlayJson, finalImageUrl: finalUrl, caption: typeof caption === "string" ? caption : undefined })
        .where(and(eq(posts.id, id), inArray(posts.status, EDITABLE_STATUSES as any)))
        .returning();
      if (!row) {
        const newInternalKey = internalKeyFromUrl(finalUrl);
        if (newInternalKey) await storage.delete(newInternalKey).catch(() => {});
        return res.status(409).json({ error: "Trạng thái bài vừa thay đổi, thử lại." });
      }
      const oldKey = internalKeyFromUrl(existing.finalImageUrl);
      if (oldKey && finalUrl !== existing.finalImageUrl) await storage.delete(oldKey).catch(() => {});
      res.json(row);
    } catch (e: any) {
      console.error("save overlay:", e?.message || e);
      res.status(500).json({ error: "Lưu overlay thất bại." });
    }
  });
}
