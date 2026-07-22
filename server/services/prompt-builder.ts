// Prompt builder cho khâu VẼ — biến các đầu vào nghiệp vụ (bối cảnh, dàn nhân
// vật + ảnh ref, ảnh meme mẫu, phong cách JSON + ảnh ref, lời thoại) thành MỘT
// prompt JSON CÓ CẤU TRÚC + danh sách ảnh tham chiếu đánh số #1..#N mà
// gemini-3.1-flash-image-preview hiểu ổn định hơn nhiều so với prompt tiếng Việt
// phẳng. Đây là đòn bẩy chất lượng lớn nhất của bản rework tạo ảnh.
//
// Thứ tự ảnh tham chiếu CỐ ĐỊNH: [ảnh nhân vật] + [ảnh meme mẫu] + [ảnh phong
// cách]; đánh số #1..#N đúng theo thứ tự đó để các trường trong JSON spec
// (match_reference_image, keep_appearance_from_reference_image,
// meme_layout_reference) trỏ đúng ảnh. Tối đa 5 ảnh (model bão hoà) — nếu vượt,
// ưu tiên GIỮ ảnh phong cách + ảnh meme, cắt bớt ảnh nhân vật.
import { generateTextGemini } from "./gemini-direct";
import type { RefImage } from "./social-proxy";

const MAX_REFERENCE_IMAGES = 5;

export interface PromptCharacter {
  name: string;
  personality?: string | null;
  refImage?: RefImage | null;
}

export interface DialogueLine {
  character: string;
  text: string;
}

export interface PromptStyle {
  name: string;
  styleJson: Record<string, any>;
  refImage?: RefImage | null;
}

export interface BuildImageInput {
  scene: string; // mô tả cảnh (tiếng Việt) — sẽ dịch sang EN
  characters: PromptCharacter[];
  memeRef?: RefImage | null; // ảnh meme mẫu (copy bố cục)
  style?: PromptStyle | null; // phong cách JSON + ảnh ref
  dialogue: DialogueLine[];
  layoutInstruction: string;
  aspectRatio: string;
  renderDialogue: boolean; // true → model tự vẽ bong bóng thoại; false → chừa chỗ overlay
}

export interface BuiltImageRequest {
  promptText: string;
  referenceImages: RefImage[];
}

// Dịch mô tả cảnh VN → EN (model text ép JSON { "scene_en": "..." }). Lỗi bất kỳ
// (thiếu key, Gemini fail, JSON không parse được, rỗng) → giữ nguyên tiếng Việt.
async function translateScene(sceneVi: string): Promise<string> {
  const trimmed = (sceneVi || "").trim();
  if (!trimmed) return "";
  const prompt = `Translate the following Vietnamese comic scene description into ONE concise English illustration description (setting, action, expressions, framing). Do not add speech text. Return ONLY JSON of the form { "scene_en": "<english>" }.

Vietnamese scene:
${trimmed}`;
  try {
    const text = await generateTextGemini(prompt);
    const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    const value = typeof parsed?.scene_en === "string" ? parsed.scene_en.trim() : "";
    return value || trimmed;
  } catch {
    return trimmed;
  }
}

// Bỏ trường undefined khỏi object (JSON.stringify tự bỏ, hàm này chỉ để rõ ý).
export async function buildImageGenerationRequest(input: BuildImageInput): Promise<BuiltImageRequest> {
  const scene = await translateScene(input.scene);

  const hasMeme = !!input.memeRef;
  const styleRef = input.style?.refImage || null;
  const hasStyleImg = !!styleRef;

  // Ảnh nhân vật có ref — cắt để tổng ≤ 5, ưu tiên giữ style + meme.
  const charsWithImg = input.characters.filter((c) => c.refImage);
  const maxChars = Math.max(0, MAX_REFERENCE_IMAGES - (hasMeme ? 1 : 0) - (hasStyleImg ? 1 : 0));
  const keptCharImgs = charsWithImg.slice(0, maxChars);

  // Đánh số #1..#N theo thứ tự cố định [chars] + [meme] + [style].
  const referenceImages: RefImage[] = [];
  const charNumber = new Map<PromptCharacter, number>();
  for (const c of keptCharImgs) {
    referenceImages.push(c.refImage as RefImage);
    charNumber.set(c, referenceImages.length);
  }
  let memeNumber: number | null = null;
  if (hasMeme) {
    referenceImages.push(input.memeRef as RefImage);
    memeNumber = referenceImages.length;
  }
  let styleNumber: number | null = null;
  if (hasStyleImg) {
    referenceImages.push(styleRef as RefImage);
    styleNumber = referenceImages.length;
  }

  const spec: Record<string, any> = {
    role: "comic_illustration",
    art_style: input.style
      ? {
          name: input.style.name,
          descriptor: input.style.styleJson || {},
          match_reference_image: styleNumber ? `#${styleNumber}` : undefined,
        }
      : undefined,
    layout: input.layoutInstruction,
    aspect_ratio: input.aspectRatio,
    scene,
    characters: input.characters.map((c) => ({
      name: c.name,
      personality: c.personality || undefined,
      keep_appearance_from_reference_image: charNumber.has(c) ? `#${charNumber.get(c)}` : undefined,
    })),
    meme_layout_reference: memeNumber ? `#${memeNumber}` : undefined,
    dialogue: input.dialogue.map((d) => ({ character: d.character, text: d.text })),
    rules: [] as string[],
  };

  const rules: string[] = [];
  if (styleNumber) {
    rules.push(
      `Match the art style EXACTLY to reference image #${styleNumber} (linework, shading, color palette, texture and mood).`
    );
  }
  for (const c of keptCharImgs) {
    rules.push(
      `Keep ${c.name}'s face, hairstyle, costume and colors IDENTICAL to reference image #${charNumber.get(c)}. Do not redesign.`
    );
  }
  if (memeNumber) {
    rules.push(
      `Reproduce the panel layout, number of panels and visual progression of meme reference image #${memeNumber}; only replace the original characters with ours.`
    );
  }
  if (input.renderDialogue) {
    rules.push(
      "Render comic speech bubbles with the given dialogue, each pointing to the correct character, Vietnamese with CORRECT diacritics, no other text besides dialogue + short onomatopoeia"
    );
  } else {
    rules.push("Do NOT render any text; leave clean space for overlay");
  }
  spec.rules = rules;

  const preamble = `You are an AI comic illustration engine. Attached reference images are numbered #1..#${referenceImages.length} in order. Follow this JSON spec exactly:`;
  const promptText = preamble + "\n\n" + JSON.stringify(spec, null, 2);

  return { promptText, referenceImages };
}
