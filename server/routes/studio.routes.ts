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
import { ART_STYLES, PANEL_LAYOUTS, WATERMARK_BRANDS, type AxisKey } from "../../shared/engine-data";

// Tra phong cách/bố cục theo key (fallback về mặc định đầu danh sách).
function resolveArtStyle(key: any): (typeof ART_STYLES)[number] {
  return ART_STYLES.find((s) => s.key === key) || ART_STYLES[0];
}
function resolvePanelLayout(key: any): (typeof PANEL_LAYOUTS)[number] {
  return PANEL_LAYOUTS.find((l) => l.key === key) || PANEL_LAYOUTS[0];
}

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
  artStyle?: string; // key ART_STYLES (mặc định tông Mắt Bão)
  panelLayout?: string; // key PANEL_LAYOUTS (1/2/4/auto)
}

// Gom ảnh tham chiếu (PHÂN VAI: ảnh nhân vật = giữ khuôn mặt; meme_template =
// copy bố cục) + phong cách + bố cục đã chọn → gọi Gemini → lưu ảnh. Dùng chung
// cho POST /api/studio/generate và /regenerate-images (post.origin="studio").
export async function generateStudioVariants(
  db: any,
  owner: string,
  params: StudioParams,
  aspectRatio: AspectRatioValue
): Promise<{ storedImages: { url: string; source: "social" | "placeholder" }[]; warning?: string }> {
  const chosenChars = params.characterIds.length
    ? await db.select().from(charactersTable).where(inArray(charactersTable.id, params.characterIds))
    : [];
  const characterNames: string[] = chosenChars.map((c: any) => c.name);
  const characterPrompts = chosenChars.map((c: any) => `${c.name}: ${c.promptDescription}`).join("\n");

  // Assets: chỉ đọc asset của mình HOẶC shared.
  const chosenAssets = params.assetIds.length
    ? await db
        .select()
        .from(assetsTable)
        .where(and(inArray(assetsTable.id, params.assetIds), or(eq(assetsTable.owner, owner), eq(assetsTable.isShared, true))))
    : [];

  // PHÂN VAI ảnh tham chiếu:
  //  - charRefs: ảnh nhân vật (thư viện) + asset kind="reference" → giữ khuôn mặt/design.
  //  - templateRefs: asset kind="meme_template" → copy bố cục/số khung.
  const charAssetImgs = (
    await Promise.all(chosenAssets.filter((a: any) => a.kind !== "meme_template").map((a: any) => readImageAsInlineData(a.imageUrl)))
  ).filter(Boolean);
  const templateImgs = (
    await Promise.all(chosenAssets.filter((a: any) => a.kind === "meme_template").map((a: any) => readImageAsInlineData(a.imageUrl)))
  ).filter(Boolean);
  const characterImgs = (
    await Promise.all(chosenChars.map((c: any) => readImageAsInlineData(c.referenceImageUrl)))
  ).filter(Boolean);

  const characterRefs = [...characterImgs, ...charAssetImgs].slice(0, MAX_REFERENCE_IMAGES) as any[];
  const templateRefs = templateImgs.slice(0, 1) as any[]; // 1 meme mẫu là đủ để copy bố cục

  const style = resolveArtStyle(params.artStyle);
  // Có meme mẫu → mặc định bám bố cục ảnh mẫu ("auto") nếu người dùng chưa chọn.
  const layoutKey = params.panelLayout || (templateRefs.length ? "auto" : "1");
  const layout = resolvePanelLayout(layoutKey);

  const result = await generateImageVariants({
    sceneText: params.promptText,
    characterNames,
    characterPrompts,
    stylePrompt: style.prompt,
    layoutInstruction: layout.instruction,
    aspectRatio,
    characterRefs,
    templateRefs,
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
    const artStyle = resolveArtStyle(body.artStyle).key;
    const panelLayout = resolvePanelLayout(body.panelLayout).key;

    try {
      const db = getDb();
      const params: StudioParams = { promptText, truc, characterIds, assetIds, artStyle, panelLayout };
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
            studioParams: { characterIds, assetIds, truc, artStyle, panelLayout },
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
