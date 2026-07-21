// VẼ routes (FR4.x) — sinh 2 biến thể ảnh không chữ, chọn ảnh, lưu overlay +
// export ảnh cuối, gửi vào hàng đợi DUYỆT. Posts.status="draft" cho tới khi
// /submit chuyển sang "cho_duyet" (Step 6 sở hữu phần kanban/checklist).
import type { Express } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, isDbConfigured } from "../db/client";
import { posts, scripts, characters as charactersTable } from "../db/schema";
import { requireAuth, getAuthUser } from "../auth-mw";
import { generateImageVariants } from "../services/social-proxy";
import { readImageAsInlineData, persistDataUrl, internalKeyFromUrl, storage } from "../storage";
import {
  persistVariantImages,
  deleteInternalVariants,
  normalizeAspectRatio,
  type AspectRatioValue,
} from "../services/image-store";
import { generateStudioVariants, type StudioParams } from "./studio.routes";
import { AXES, STYLE_PROMPT, WATERMARK_BRANDS, type AxisKey } from "../../shared/engine-data";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Chỉ được chỉnh ảnh/overlay khi bài đang ở khâu VẼ (nháp) hoặc quay lại sửa
// thoại — KHÔNG cho đụng bài đã vào kanban duyệt / đã duyệt / đã đăng (chống
// kéo ngược state machine, codex HIGH #1).
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

// Logic build prompt (style + nhân vật + panels) + ảnh tham chiếu + gọi
// generateImageVariants + lưu 2 biến thể vào storage — dùng chung cho cả
// /api/images/generate (tạo mới) và /api/posts/:id/regenerate-images (vẽ lại).
// `script` phải đã có selectedVariant hợp lệ (caller tự kiểm tra).
//
// Chọn nhân vật: nếu truyền `characterIds` (mảng UUID không rỗng) → dùng ĐÚNG
// các nhân vật đó (người vận hành tự chọn dàn diễn). Nếu rỗng/không truyền →
// giữ hành vi cũ: lấy nhân vật chủ đạo theo trục (AXES.leadCharacters).
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
  const characterNames = activeChars.map((c: any) => c.name);
  const characterPrompts = activeChars.map((c: any) => `${c.name}: ${c.promptDescription}`).join("\n");

  // Đính ảnh nhân vật tham chiếu (nếu đã có trong thư viện) để Gemini giữ
  // đúng ngoại hình — tối đa 3 ảnh (mục 2.2 v3.md: tối đa 3 AI/khung; giới
  // hạn để prompt không quá nặng). Nhân vật chưa có ảnh → bỏ qua, chỉ dùng text.
  const referenceImages = (
    await Promise.all(activeChars.slice(0, 3).map((c: any) => readImageAsInlineData(c.referenceImageUrl)))
  ).filter((x: any): x is { mimeType: string; data: string } => x !== null);

  const panelsText = variant.panels.map((p: string, i: number) => `Khung ${i + 1}: ${p}`).join("\n");

  const result = await generateImageVariants({
    styleSummary: `${STYLE_PROMPT}\n\n${characterPrompts}`,
    panelsText,
    characterNames,
    referenceImages,
    aspectRatio,
  });

  const storedImages = await persistVariantImages(result.images);
  return { storedImages, warning: result.warning };
}

export function registerImageRoutes(app: Express) {
  // FR4.1/4.2 — ghép style chung + mô tả nhân vật (character reference
  // library) + mô tả khung từ kịch bản đã chọn → sinh 2 biến thể ảnh KHÔNG chữ.
  app.post("/api/images/generate", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const user = getAuthUser(req)!;
    const { scriptId } = req.body || {};
    if (!scriptId || !UUID_RE.test(scriptId)) return res.status(400).json({ error: "scriptId không hợp lệ." });
    const aspectRatio = normalizeAspectRatio(req.body?.aspectRatio);
    // Optional — người vận hành tự chọn dàn nhân vật; rỗng → lấy theo trục (cũ).
    const characterIds = onlyUuids(req.body?.characterIds);

    try {
      const db = getDb();
      const [script] = await db.select().from(scripts).where(eq(scripts.id, scriptId));
      if (!script) return res.status(404).json({ error: "Không tìm thấy kịch bản." });
      if (script.selectedVariant === null || script.selectedVariant === undefined) {
        return res.status(400).json({ error: "Kịch bản chưa chọn phương án (FR3.3)." });
      }
      const variant = script.contentJson[script.selectedVariant];
      if (!variant) return res.status(400).json({ error: "Phương án đã chọn không hợp lệ." });

      const { storedImages, warning } = await generateAndStoreImageVariants(db, script, aspectRatio, characterIds);

      const [row] = await db
        .insert(posts)
        .values({
          scriptId,
          owner: user,
          imageVariants: storedImages,
          selectedImageUrl: null,
          overlayJson: {
            textBoxes: [],
            watermarkBrand: WATERMARK_BRANDS[script.truc as AxisKey] || "MATBAO",
            aspectRatio,
            // Lưu lựa chọn nhân vật để /regenerate-images vẽ lại đúng dàn.
            characterIds,
          },
          caption: variant.caption,
          status: "draft",
        })
        .returning();

      res.status(201).json({ ...row, warning });
    } catch (e: any) {
      console.error("generate images:", e?.message || e);
      res.status(500).json({ error: "Sinh ảnh thất bại." });
    }
  });

  // B2.4 — vẽ lại 2 biến thể ảnh (dùng lại prompt build + referenceImages +
  // aspectRatio đã lưu trong overlayJson của post + script tương ứng). Guard:
  // chỉ khi status ∈ EDITABLE_STATUSES. Xoá ảnh biến thể CŨ khỏi storage sau
  // khi update DB thành công, set selectedImageUrl=null (ảnh cũ đã chọn không
  // còn tồn tại nữa).
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
        // Bài Studio (scriptId null) — vẽ lại từ tham số Studio đã lưu trong overlayJson.
        const sp = overlay?.studioParams || {};
        const params: StudioParams = {
          promptText: existing.promptText || "",
          truc: (existing.truc as any) || null,
          characterIds: onlyUuids(sp.characterIds),
          assetIds: onlyUuids(sp.assetIds),
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
        // Vẽ lại đúng dàn nhân vật đã chọn lúc tạo (nếu có).
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
        // Update trượt (status vừa đổi) — dọn ảnh mới vừa sinh để không rác storage.
        await deleteInternalVariants(storedImages);
        return res.status(409).json({ error: "Trạng thái bài vừa thay đổi, thử lại." });
      }
      // Update DB xong xuôi mới dọn ảnh biến thể CŨ (nếu là file nội bộ).
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
      // Atomic: chỉ update khi status vẫn nằm trong nhóm được sửa (chống race).
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
      const [existing] = await db.select().from(posts).where(eq(posts.id, id));
      if (!existing) return res.status(404).json({ error: "Không tìm thấy bài." });
      if (!EDITABLE_STATUSES.includes(existing.status as any)) {
        return res.status(409).json({ error: `Bài đang ở trạng thái "${existing.status}", không thể lưu overlay.` });
      }

      // Ảnh cuối (PNG từ Canvas) → lưu storage, chỉ giữ URL trong DB.
      const finalUrl = (await persistDataUrl("posts", finalImageDataUrl)) || finalImageDataUrl;

      // Atomic: chỉ update khi status vẫn nằm trong nhóm được sửa (chống race).
      const [row] = await db
        .update(posts)
        .set({ overlayJson, finalImageUrl: finalUrl, caption: typeof caption === "string" ? caption : undefined })
        .where(and(eq(posts.id, id), inArray(posts.status, EDITABLE_STATUSES as any)))
        .returning();
      if (!row) {
        // Update trượt (status vừa đổi) — dọn ảnh mới vừa ghi để không rác storage.
        const newKey = internalKeyFromUrl(finalUrl);
        if (newKey) await storage.delete(newKey).catch(() => {});
        return res.status(409).json({ error: "Trạng thái bài vừa thay đổi, thử lại." });
      }
      // Update DB xong xuôi mới dọn ảnh cuối CŨ (nếu là file nội bộ) — tránh mất
      // ảnh khi update fail giữa chừng (codex MEDIUM #5).
      const oldKey = internalKeyFromUrl(existing.finalImageUrl);
      if (oldKey && finalUrl !== existing.finalImageUrl) await storage.delete(oldKey).catch(() => {});
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
      if (!EDITABLE_STATUSES.includes(existing.status as any)) {
        return res.status(409).json({ error: `Bài đang ở trạng thái "${existing.status}", không thể gửi duyệt.` });
      }
      if (!existing.finalImageUrl) return res.status(400).json({ error: "Chưa có ảnh cuối (hoàn tất text-overlay trước)." });
      // Atomic: draft|sua_thoai → cho_duyet.
      const [row] = await db
        .update(posts)
        .set({ status: "cho_duyet" })
        .where(and(eq(posts.id, id), inArray(posts.status, EDITABLE_STATUSES as any)))
        .returning();
      if (!row) return res.status(409).json({ error: "Trạng thái bài vừa thay đổi, thử lại." });
      res.json(row);
    } catch (e: any) {
      console.error("submit post:", e?.message || e);
      res.status(500).json({ error: "Gửi duyệt thất bại." });
    }
  });
}
