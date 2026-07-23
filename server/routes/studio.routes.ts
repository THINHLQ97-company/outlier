// Studio "Vẽ" — sinh ảnh TRỰC TIẾP từ mô tả tự do + nhân vật + ảnh tham chiếu
// (assets) + phong cách (styles) + lời thoại, KHÔNG đi qua kịch bản. Kết quả là
// 1 post origin="studio", status="draft" → tái dùng select-image / overlay /
// regenerate của images.routes.ts.
//
// Bản rework: prompt gửi Gemini là JSON CÓ CẤU TRÚC (buildImageGenerationRequest)
// — bối cảnh, nhân vật + tính cách + ảnh ref, ảnh meme mẫu, phong cách JSON + ảnh
// ref, lời thoại gắn đúng nhân vật, bố cục, tỉ lệ. Lời thoại: khi có thoại →
// renderDialogue=true (model tự vẽ bong bóng); overlay editor giữ ở frontend.
import type { Express } from "express";
import { and, eq, inArray, or } from "drizzle-orm";
import { getDb, isDbConfigured } from "../db/client";
import { posts, characters as charactersTable, assets as assetsTable, styles as stylesTable, users } from "../db/schema";
import { requireAuth, getAuthUser } from "../auth-mw";
import { generateImageVariants } from "../services/social-proxy";
import { readImageAsInlineData } from "../storage";
import {
  buildImageGenerationRequest,
  type PromptCharacter,
  type PromptStyle,
  type DialogueLine,
} from "../services/prompt-builder";
import { persistVariantImages, normalizeAspectRatio, type AspectRatioValue } from "../services/image-store";
import { writeScenarios } from "../services/scenario-writer";
import { retrieveRagExamples, getRagProfile, buildRagGuidance } from "../services/rag";
import { PANEL_LAYOUTS, BACKGROUND_OPTIONS } from "../../shared/engine-data";

function resolvePanelLayout(key: any): (typeof PANEL_LAYOUTS)[number] {
  return PANEL_LAYOUTS.find((l) => l.key === key) || PANEL_LAYOUTS[0];
}
function resolveBackground(key: any): (typeof BACKGROUND_OPTIONS)[number] {
  return BACKGROUND_OPTIONS.find((b) => b.key === key) || BACKGROUND_OPTIONS[0];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

// Chuẩn hoá lời thoại: bỏ dòng rỗng; nếu đã chọn nhân vật thì chỉ giữ dòng khớp
// tên nhân vật đã chọn (khớp không phân biệt hoa/thường), ngược lại giữ mọi dòng
// có tên + nội dung (cho phép gõ tên tự do khi chưa chọn nhân vật/ở chế độ demo).
function normalizeDialogue(raw: any, characterNames: string[]): DialogueLine[] {
  if (!Array.isArray(raw)) return [];
  const nameSet = new Set(characterNames.map((n) => n.toLowerCase()));
  const out: DialogueLine[] = [];
  for (const d of raw) {
    const character = typeof d?.character === "string" ? d.character.trim() : "";
    const text = typeof d?.text === "string" ? d.text.trim() : "";
    if (!character || !text) continue;
    if (nameSet.size > 0 && !nameSet.has(character.toLowerCase())) continue;
    out.push({ character, text });
  }
  return out;
}

// Tham số Studio đủ để vẽ (lưu lại vào overlayJson.studioParams để /regenerate).
export interface StudioParams {
  promptText: string;
  characterIds: string[];
  assetIds: string[];
  styleId?: string | null;
  dialogue: DialogueLine[];
  panelLayout?: string; // key PANEL_LAYOUTS (1/2/4/auto)
  background?: string; // key BACKGROUND_OPTIONS (scene/white/minimal)
  useRag?: boolean; // bật RAG: đọc thêm "gu đã học" từ ảnh đã thích
}

// Chọn phong cách: styleId (owner==user | isShared | isDefault) → phong cách đó;
// không chọn/không thấy → phong cách isDefault đầu tiên. Trả PromptStyle (styleJson
// + ảnh ref inline) hoặc null nếu chưa seed phong cách nào.
export async function resolveStyle(db: any, styleId: string | null | undefined, owner: string): Promise<PromptStyle | null> {
  let row: any = null;
  if (styleId && UUID_RE.test(styleId)) {
    [row] = await db
      .select()
      .from(stylesTable)
      .where(
        and(
          eq(stylesTable.id, styleId),
          or(eq(stylesTable.owner, owner), eq(stylesTable.isShared, true), eq(stylesTable.isDefault, true))
        )
      );
  }
  if (!row) {
    [row] = await db
      .select()
      .from(stylesTable)
      .where(eq(stylesTable.isDefault, true))
      .orderBy(stylesTable.createdAt)
      .limit(1);
  }
  if (!row) return null;
  const refImage = await readImageAsInlineData(row.referenceImageUrl);
  return { name: row.name, styleJson: (row.styleJson as Record<string, any>) || {}, refImage };
}

// Gom nhân vật (name/personality/ảnh ref) + assets (meme_template→memeRef;
// reference→thêm ảnh ref nhân vật) + phong cách + bố cục + lời thoại → dựng prompt
// JSON có cấu trúc → gọi Gemini → lưu ảnh. Dùng chung cho POST /api/studio/generate
// và /regenerate-images (post.origin="studio").
export async function generateStudioVariants(
  db: any,
  owner: string,
  params: StudioParams,
  aspectRatio: AspectRatioValue
): Promise<{
  storedImages: { url: string; source: "social" | "placeholder" }[];
  warning?: string;
  promptText: string;
  charactersUsed: string[];
  styleName: string | null;
  ragUsed: number; // số ví dụ RAG đã chèn (0 = không dùng)
}> {
  const chosenChars = params.characterIds.length
    ? await db.select().from(charactersTable).where(inArray(charactersTable.id, params.characterIds))
    : [];

  // Assets: chỉ đọc asset của mình HOẶC shared.
  const chosenAssets = params.assetIds.length
    ? await db
        .select()
        .from(assetsTable)
        .where(and(inArray(assetsTable.id, params.assetIds), or(eq(assetsTable.owner, owner), eq(assetsTable.isShared, true))))
    : [];

  // Nhân vật (thư viện) → PromptCharacter kèm ảnh ref.
  const characters: PromptCharacter[] = await Promise.all(
    chosenChars.map(async (c: any) => ({
      name: c.name,
      personality: c.personality,
      refImage: await readImageAsInlineData(c.referenceImageUrl),
    }))
  );

  // Asset kind="reference" → thêm như nhân vật phụ (giữ đúng ngoại hình/ảnh ref).
  const refAssets = chosenAssets.filter((a: any) => a.kind !== "meme_template");
  for (const a of refAssets) {
    const refImage = await readImageAsInlineData(a.imageUrl);
    if (refImage) characters.push({ name: a.name, personality: null, refImage });
  }

  // Asset kind="meme_template" → 1 ảnh meme mẫu (copy bố cục).
  const memeAsset = chosenAssets.find((a: any) => a.kind === "meme_template");
  const memeRef = memeAsset ? await readImageAsInlineData(memeAsset.imageUrl) : null;

  const style = await resolveStyle(db, params.styleId, owner);

  // Bố cục: theo panelLayout đã chọn; chưa chọn + có meme → bám ảnh mẫu ("auto").
  const layoutKey = params.panelLayout || (memeRef ? "auto" : "1");
  const layout = resolvePanelLayout(layoutKey);

  const characterNames = characters.map((c) => c.name);
  const dialogue = normalizeDialogue(params.dialogue, characterNames);

  // RAG: bật → truy hồi ví dụ đã thích giống cảnh này + hồ sơ sở thích, chèn text.
  let ragGuidance = "";
  let ragUsed = 0;
  if (params.useRag) {
    try {
      const [examples, profileText] = await Promise.all([
        retrieveRagExamples(db, owner, params.promptText),
        getRagProfile(db, owner),
      ]);
      ragGuidance = buildRagGuidance(examples, profileText);
      ragUsed = examples.length;
    } catch (e: any) {
      console.warn("[studio] RAG retrieval lỗi — bỏ qua:", e?.message || e);
    }
  }

  const { promptText, referenceImages, charactersUsed } = await buildImageGenerationRequest({
    scene: params.promptText,
    characters,
    memeRef,
    style,
    dialogue,
    layoutInstruction: layout.instruction,
    aspectRatio,
    renderDialogue: dialogue.length > 0,
    backgroundInstruction: resolveBackground(params.background).instruction,
    ragGuidance,
  });

  const result = await generateImageVariants({
    promptText,
    referenceImages,
    aspectRatio,
    demoLabel: style?.name || characterNames.join(", ") || "Studio",
  });

  const storedImages = await persistVariantImages(result.images);
  return { storedImages, warning: result.warning, promptText, charactersUsed, styleName: style?.name || null, ragUsed };
}

export function registerStudioRoutes(app: Express) {
  // POST /api/studio/suggest-scenario — "AI viết kịch bản hài": biến 1 ý tưởng
  // thô thành 3 kịch bản comic cụ thể (bối cảnh + nhân vật + lời thoại) dùng dàn
  // nhân vật cố định. Kết quả điền vào form Studio. Thiếu key → kịch bản mẫu (demo).
  app.post("/api/studio/suggest-scenario", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const body = req.body || {};
    const idea = typeof body.idea === "string" ? body.idea.trim() : "";
    if (!idea) return res.status(400).json({ error: "Thiếu ý tưởng/mô tả để AI viết kịch bản." });
    try {
      const db = getDb();
      const cast = await db.select().from(charactersTable);
      const characterHints = Array.isArray(body.characterHints)
        ? body.characterHints.filter((n: any) => typeof n === "string")
        : [];
      const result = await writeScenarios({
        idea,
        cast: cast.map((c: any) => ({ name: c.name, kind: c.kind, personality: c.personality, catchphrase: c.catchphrase })),
        characterHints,
      });
      res.json(result);
    } catch (e: any) {
      console.error("suggest-scenario:", e?.message || e);
      res.status(500).json({ error: "Viết kịch bản thất bại." });
    }
  });

  // POST /api/studio/generate — sinh ảnh trực tiếp → post draft origin="studio".
  app.post("/api/studio/generate", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const user = getAuthUser(req)!;
    const body = req.body || {};
    const promptText = typeof body.promptText === "string" ? body.promptText.trim() : "";
    if (!promptText) return res.status(400).json({ error: "Thiếu mô tả (promptText)." });

    const characterIds = onlyUuids(body.characterIds);
    const assetIds = onlyUuids(body.assetIds);
    const styleId = typeof body.styleId === "string" && UUID_RE.test(body.styleId) ? body.styleId : null;
    const aspectRatio = normalizeAspectRatio(body.aspectRatio);
    const isShared = body.isShared === true;
    const caption = typeof body.caption === "string" ? body.caption : "";
    const panelLayout = resolvePanelLayout(body.panelLayout).key;
    const background = resolveBackground(body.background).key;
    const useRag = body.useRag === true;
    // Lời thoại thô (chuẩn hoá lại theo nhân vật thực tế bên trong generateStudioVariants).
    const dialogueRaw = Array.isArray(body.dialogue) ? body.dialogue : [];

    try {
      const db = getDb();
      const params: StudioParams = { promptText, characterIds, assetIds, styleId, dialogue: dialogueRaw, panelLayout, background, useRag };
      const gen = await generateStudioVariants(db, user, params, aspectRatio);
      const { storedImages, warning } = gen;

      const [row] = await db
        .insert(posts)
        .values({
          scriptId: null,
          origin: "studio",
          owner: user,
          isShared,
          truc: null, // Studio không còn sinh caption theo trục — watermark mặc định.
          promptText,
          imageVariants: storedImages,
          selectedImageUrl: null,
          overlayJson: {
            textBoxes: [],
            watermarkBrand: "MATBAO",
            aspectRatio,
            // Lưu tham số Studio để /regenerate-images vẽ lại đúng (scriptId null).
            studioParams: { characterIds, assetIds, styleId, dialogue: dialogueRaw, panelLayout, background, useRag },
            // Minh bạch: prompt JSON đã gửi Gemini + nhân vật + style + RAG đã dùng.
            promptDebug: { prompt: gen.promptText, characters: gen.charactersUsed, style: gen.styleName, ragUsed: gen.ragUsed },
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

// Kiểm tra 1 username có phải admin đang hoạt động không (dùng ở styles.routes
// cho các thao tác chỉ-admin trên phong cách mặc định). Đặt ở đây để tái dùng.
export async function isActiveAdmin(username: string): Promise<boolean> {
  try {
    const [u] = await getDb().select().from(users).where(eq(users.username, username));
    return !!u && u.role === "admin" && u.isActive;
  } catch {
    return false;
  }
}
