// Studio "Vẽ tự do" (FR mở rộng) — sinh ảnh TRỰC TIẾP từ mô tả tự do + nhân
// vật đã chọn + ảnh tham chiếu (assets), KHÔNG đi qua kịch bản. Kết quả là 1
// post origin="studio", status="draft" → tái dùng nguyên luồng
// select-image / overlay / submit của images.routes.ts + posts.routes.ts
// (các route đó chỉ cần post tồn tại + status editable, KHÔNG phụ thuộc scriptId).
import type { Express } from "express";
import { and, eq, inArray, or } from "drizzle-orm";
import { getDb, isDbConfigured } from "../db/client";
import { posts, characters as charactersTable, assets as assetsTable } from "../db/schema";
import { requireAuth, getAuthUser } from "../auth-mw";
import { generateImageVariants } from "../services/social-proxy";
import { readImageAsInlineData } from "../storage";
import {
  persistVariantImages,
  normalizeAspectRatio,
  type AspectRatioValue,
} from "../services/image-store";
import { STYLE_PROMPT, WATERMARK_BRANDS, type AxisKey } from "../../shared/engine-data";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRUC_VALUES = ["ai", "ke_toan", "hosting"] as const;
const MAX_REFERENCE_IMAGES = 4;

function dbDown(res: any): boolean {
  if (!isDbConfigured()) {
    res.status(503).json({ error: "Tính năng dữ liệu chưa khả dụng (thiếu DATABASE_URL)." });
    return true;
  }
  return false;
}

function onlyUuids(v: any): string[] {
  return Array.isArray(v) ? v.filter((x) => typeof x === "string" && UUID_RE.test(x)) : [];
}

export interface StudioParams {
  promptText: string;
  truc: AxisKey | null;
  characterIds: string[];
  assetIds: string[];
}

// Xây prompt (STYLE_PROMPT + mô tả nhân vật đã chọn) + gom ảnh tham chiếu
// (ảnh nhân vật + ảnh assets, tối đa 4) + gọi Gemini + lưu ảnh vào storage.
// Dùng chung cho POST /api/studio/generate (tạo mới) và
// /api/posts/:id/regenerate-images khi post.origin="studio" (vẽ lại).
export async function generateStudioVariants(
  db: any,
  owner: string,
  params: StudioParams,
  aspectRatio: AspectRatioValue
): Promise<{ storedImages: { url: string; source: "social" | "placeholder" }[]; warning?: string }> {
  // Nhân vật đã chọn (nếu có) — không bắt buộc, cho phép vẽ chỉ từ mô tả + tham chiếu.
  const chosenChars = params.characterIds.length
    ? await db.select().from(charactersTable).where(inArray(charactersTable.id, params.characterIds))
    : [];
  const characterNames: string[] = chosenChars.map((c: any) => c.name);
  const characterPrompts = chosenChars.map((c: any) => `${c.name}: ${c.promptDescription}`).join("\n");

  // Assets tham chiếu: chỉ đọc asset của mình HOẶC được chia sẻ.
  const chosenAssets = params.assetIds.length
    ? await db
        .select()
        .from(assetsTable)
        .where(and(inArray(assetsTable.id, params.assetIds), or(eq(assetsTable.owner, owner), eq(assetsTable.isShared, true))))
    : [];

  // Gom ảnh tham chiếu: ảnh nhân vật trước, rồi ảnh asset — cắt tối đa 4.
  const charRefs = (
    await Promise.all(chosenChars.map((c: any) => readImageAsInlineData(c.referenceImageUrl)))
  ).filter((x: any): x is { mimeType: string; data: string } => x !== null);
  const assetRefs = (
    await Promise.all(chosenAssets.map((a: any) => readImageAsInlineData(a.imageUrl)))
  ).filter((x: any): x is { mimeType: string; data: string } => x !== null);
  const referenceImages = [...charRefs, ...assetRefs].slice(0, MAX_REFERENCE_IMAGES);

  // panelsText = mô tả tự do; asset meme_template có note → thêm hướng dẫn diễn giải.
  let panelsText = params.promptText;
  const memeNotes = chosenAssets
    .filter((a: any) => a.kind === "meme_template" && a.note && a.note.trim())
    .map((a: any) => `Diễn giải lại theo bố cục/tinh thần meme tham chiếu, note: ${a.note.trim()}`);
  if (memeNotes.length) panelsText = `${panelsText}\n\n${memeNotes.join("\n")}`;

  const styleSummary = characterPrompts ? `${STYLE_PROMPT}\n\n${characterPrompts}` : STYLE_PROMPT;

  const result = await generateImageVariants({
    styleSummary,
    panelsText,
    characterNames,
    referenceImages,
    aspectRatio,
  });

  const storedImages = await persistVariantImages(result.images);
  return { storedImages, warning: result.warning };
}

export function registerStudioRoutes(app: Express) {
  // POST /api/studio/generate — sinh ảnh trực tiếp → post draft origin="studio".
  app.post("/api/studio/generate", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const user = getAuthUser(req)!;
    const body = req.body || {};
    const promptText = typeof body.promptText === "string" ? body.promptText.trim() : "";
    if (!promptText) return res.status(400).json({ error: "Thiếu mô tả (promptText)." });

    const truc: AxisKey | null = TRUC_VALUES.includes(body.truc) ? body.truc : null;
    const characterIds = onlyUuids(body.characterIds);
    const assetIds = onlyUuids(body.assetIds);
    const aspectRatio = normalizeAspectRatio(body.aspectRatio);
    const isShared = body.isShared === true;
    const caption = typeof body.caption === "string" ? body.caption : "";

    try {
      const db = getDb();
      const params: StudioParams = { promptText, truc, characterIds, assetIds };
      const { storedImages, warning } = await generateStudioVariants(db, user, params, aspectRatio);

      const [row] = await db
        .insert(posts)
        .values({
          scriptId: null,
          origin: "studio",
          owner: user,
          isShared,
          truc,
          promptText,
          imageVariants: storedImages,
          selectedImageUrl: null,
          overlayJson: {
            textBoxes: [],
            watermarkBrand: truc ? WATERMARK_BRANDS[truc] : "MATBAO",
            aspectRatio,
            // Lưu lại tham số Studio để /regenerate-images vẽ lại đúng (scriptId null).
            studioParams: { characterIds, assetIds, truc },
          },
          caption,
          status: "draft",
        })
        .returning();

      res.status(201).json({ ...row, warning });
    } catch (e: any) {
      console.error("studio generate:", e?.message || e);
      res.status(500).json({ error: "Vẽ ảnh Studio thất bại." });
    }
  });
}
