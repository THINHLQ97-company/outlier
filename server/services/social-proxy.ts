// DỊCH (generateScriptVariants) + VẼ (generateImageVariants) — gọi Gemini
// TRỰC TIẾP qua server/services/gemini-direct.ts (GEMINI_API_KEY), pattern y
// hệt share-projects/marcow-crop đang chạy production. API key KHÔNG BAO GIỜ
// đi tới client.
//
// Đổi kiến trúc (xem CLAUDE.md mục 3): trước đây 2 flow này proxy sang
// share-projects/social (SOCIAL_BACKEND_URL) — endpoint đó chưa xác nhận
// tồn tại/reachable nên đã bỏ, thay bằng gọi Gemini trực tiếp. Tên file/hàm
// giữ nguyên ("social-proxy.ts") để không phải sửa import ở
// scripts.routes.ts/images.routes.ts — chỉ đổi cơ chế gọi API bên trong.
//
// Khi thiếu GEMINI_API_KEY hoặc lệnh gọi Gemini thất bại → fallback sang kịch
// bản mẫu / ảnh placeholder tự sinh (không phụ thuộc mạng ngoài), đánh dấu
// `isDemo: true`, log warning rõ ràng — KHÔNG throw, không crash toàn app.
import { buildScriptPrompt, FORMATS, type AxisKey } from "../../shared/engine-data";
import { generateTextGemini, generateImageGemini } from "./gemini-direct";

export interface GeneratedScriptVariant {
  formatMeme: string;
  panels: string[];
  caption: string;
  ctaSoft: string;
}

export interface GenerateScriptResult {
  variants: GeneratedScriptVariant[];
  isDemo: boolean;
  warning?: string;
}

function demoVariants(signalSummary: string, formatMeme: string): GeneratedScriptVariant[] {
  const codes = [formatMeme, ...FORMATS.map((f) => f.code).filter((c) => c !== formatMeme)].slice(0, 3);
  const shortSummary = signalSummary.length > 60 ? `${signalSummary.slice(0, 57)}...` : signalSummary;
  return codes.map((code, i) => {
    const fmt = FORMATS.find((f) => f.code === code)!;
    return {
      formatMeme: code,
      panels:
        fmt.structure.includes("2 khung")
          ? [`[DEMO] ${shortSummary}`, `[DEMO] Punchline phương án ${i + 1}`]
          : [`[DEMO] ${shortSummary}`],
      caption: `[DEMO — GEMINI_API_KEY chưa cấu hình] Kịch bản mẫu ${i + 1}/3 cho format ${code}.`,
      ctaSoft: "",
    };
  });
}

export async function generateScriptVariants(input: {
  signalSummary: string;
  truc: AxisKey;
  formatMeme: string;
}): Promise<GenerateScriptResult> {
  if (!process.env.GEMINI_API_KEY) {
    const warning = "[social-proxy] GEMINI_API_KEY chưa cấu hình — dùng kịch bản mẫu (demo).";
    console.warn(warning);
    return { variants: demoVariants(input.signalSummary, input.formatMeme), isDemo: true, warning };
  }

  const prompt = buildScriptPrompt(input);
  try {
    const text = await generateTextGemini(prompt);
    const parsed = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1));
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("Phản hồi không đúng định dạng JSON array.");
    return {
      variants: parsed.map((v: any) => ({
        formatMeme: v.formatMeme || input.formatMeme,
        panels: Array.isArray(v.panels) ? v.panels : [String(v.panels || "")],
        caption: v.caption || "",
        ctaSoft: v.ctaSoft || "",
      })),
      isDemo: false,
    };
  } catch (e: any) {
    const warning = `[social-proxy] Gọi Gemini generateText thất bại (${e?.message || e}) — dùng kịch bản mẫu (demo).`;
    console.warn(warning);
    return { variants: demoVariants(input.signalSummary, input.formatMeme), isDemo: true, warning };
  }
}

export interface GenerateImageResult {
  images: { url: string; source: "social" | "placeholder" }[];
  isDemo: boolean;
  warning?: string;
}

// Placeholder tự sinh — SVG data URI, không phụ thuộc mạng ngoài. Kích thước
// vuông 1024x1024 (đủ dùng làm canvas nền cho text-overlay editor Step 5).
function placeholderImage(label: string, seedColor: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
    <rect width="100%" height="100%" fill="${seedColor}"/>
    <rect x="24" y="24" width="976" height="976" fill="none" stroke="#ffffff" stroke-width="4" stroke-dasharray="12 10"/>
    <text x="50%" y="46%" font-family="sans-serif" font-size="40" fill="#ffffff" text-anchor="middle">ẢNH DEMO</text>
    <text x="50%" y="53%" font-family="sans-serif" font-size="24" fill="#ffffff" text-anchor="middle">${label}</text>
    <text x="50%" y="60%" font-family="sans-serif" font-size="18" fill="#ffffffaa" text-anchor="middle">GEMINI_API_KEY chưa cấu hình</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

export interface RefImage {
  mimeType: string;
  data: string;
}

// CHỈNH SỬA ảnh bằng câu lệnh (image-to-image edit) — như luồng iterative của
// ChatGPT: đưa ảnh hiện tại + 1 câu chỉnh ("chuyển POV thứ nhất, nền trắng, bỏ
// bớt...") → Gemini vẽ lại CHỈ thay đổi phần đó, giữ nguyên phần còn lại. Trả về
// 1 ảnh data URL. Thiếu key/lỗi → giữ nguyên ảnh cũ (trả về source), warning.
export async function editImage(input: {
  sourceImage: RefImage;
  instruction: string;
  aspectRatio?: string;
  // Ảnh + tên các nhân vật CÓ trong khung — để model biết "Grok/Gemini..." là ai
  // khi câu lệnh nhắc tới nhân vật cụ thể, và giữ đúng ngoại hình khi sửa.
  characters?: { name: string; refImage: RefImage }[];
  // Mô tả cảnh/ý đồ của prompt ĐÃ tạo ra ảnh này — để Gemini hiểu bối cảnh gốc
  // khi chỉnh tiếp (vd người dùng nói "bỏ nhân vật thừa" thì biết ai là thừa).
  previousContext?: string;
  // Mặt nạ vùng chỉnh ("circle to edit"): ảnh cùng kích thước, VÙNG TRẮNG = nơi
  // áp thay đổi, VÙNG ĐEN = giữ nguyên. Có mask → chỉ sửa trong vùng khoanh.
  maskImage?: RefImage | null;
}): Promise<{ url: string; source: "social" | "placeholder"; isDemo: boolean; warning?: string }> {
  const sourceUrl = `data:${input.sourceImage.mimeType};base64,${input.sourceImage.data}`;
  if (!process.env.GEMINI_API_KEY) {
    const warning = "GEMINI_API_KEY chưa cấu hình — không chỉnh được ảnh (demo).";
    console.warn(`[social-proxy] ${warning}`);
    return { url: sourceUrl, source: "placeholder", isDemo: true, warning };
  }

  const chars = input.characters || [];
  // Ảnh: #1 = ảnh hiện tại cần sửa; #2..#N = ảnh mẫu từng nhân vật; #cuối = mask (nếu có).
  const images: RefImage[] = [input.sourceImage, ...chars.map((c) => c.refImage)];
  const charLines = chars.map((c, i) => `#${i + 2} = ${c.name}`).join("; ");
  const charBlock = chars.length
    ? `The characters that appear in image #1, with their reference designs attached: ${charLines}. When the change mentions a character by name, use these references to identify them, and keep EVERY character's face, costume and colors IDENTICAL to their reference.`
    : "";

  const contextBlock = input.previousContext?.trim()
    ? `\nORIGINAL BRIEF that produced image #1 (for context — do NOT re-render it, only use it to understand the scene and who is who): ${input.previousContext.trim()}\n`
    : "";

  // Mask "circle to edit": đẩy vào cuối danh sách ảnh, ghi rõ số hiệu.
  let maskBlock = "";
  if (input.maskImage) {
    images.push(input.maskImage);
    const maskNo = images.length;
    maskBlock = `\nIMPORTANT — image #${maskNo} is an EDIT MASK the user drew over image #1. Apply the change ONLY inside the WHITE area of the mask; every pixel where the mask is BLACK must stay IDENTICAL to image #1. Do NOT render the mask itself in the output.\n`;
  }

  const prompt = `You are editing the attached comic illustration (image #1). ${charBlock}${contextBlock}${maskBlock}

Apply ONLY the following change and keep EVERYTHING ELSE identical — the other characters, the art style, and the overall composition must stay the same. Do NOT redraw from scratch.

CHANGE TO APPLY: ${input.instruction}

Output the full edited image at the same art style. If the change asks to remove/hide something, remove it cleanly and fill the area naturally to match the surrounding background.`;

  try {
    const url = await generateImageGemini(prompt, images, input.aspectRatio || "1:1");
    return { url, source: "social", isDemo: false };
  } catch (e: any) {
    const warning = `Chỉnh ảnh thất bại (${e?.message || e}) — giữ nguyên ảnh cũ.`;
    console.warn(`[social-proxy] ${warning}`);
    return { url: sourceUrl, source: "placeholder", isDemo: true, warning };
  }
}

// VẼ — sinh 2 biến thể ảnh từ MỘT prompt JSON có cấu trúc (dựng sẵn ở
// server/services/prompt-builder.ts) + ảnh tham chiếu đã đánh số #1..#N. Không
// còn tự dịch/tự ghép prompt ở đây — mọi logic prompt nằm ở prompt-builder để
// dùng chung cho Studio (và pipeline regenerate). Thiếu GEMINI_API_KEY hoặc gọi
// Gemini lỗi → fallback 2 ảnh placeholder (demoLabel), log warning, KHÔNG throw.
export async function generateImageVariants(input: {
  promptText: string;
  referenceImages?: RefImage[];
  aspectRatio?: string;
  demoLabel?: string;
}): Promise<GenerateImageResult> {
  const label = input.demoLabel || "Ảnh minh hoạ";

  if (!process.env.GEMINI_API_KEY) {
    const warning = "[social-proxy] GEMINI_API_KEY chưa cấu hình — dùng ảnh placeholder (demo).";
    console.warn(warning);
    return {
      images: [
        { url: placeholderImage(label, "#D97757"), source: "placeholder" },
        { url: placeholderImage(label, "#C66545"), source: "placeholder" },
      ],
      isDemo: true,
      warning,
    };
  }

  const refs = input.referenceImages && input.referenceImages.length ? input.referenceImages : undefined;

  try {
    // 2 biến thể độc lập từ cùng 1 prompt (FR4.2) — gọi song song.
    const results = await Promise.all(
      [0, 1].map(async () => ({
        url: await generateImageGemini(input.promptText, refs, input.aspectRatio || "1:1"),
        source: "social" as const, // "ảnh Gemini thật" (khác "placeholder")
      }))
    );
    return { images: results, isDemo: false };
  } catch (e: any) {
    const warning = `[social-proxy] Gọi Gemini generate-image thất bại (${e?.message || e}) — dùng ảnh placeholder (demo).`;
    console.warn(warning);
    return {
      images: [
        { url: placeholderImage(label, "#D97757"), source: "placeholder" },
        { url: placeholderImage(label, "#C66545"), source: "placeholder" },
      ],
      isDemo: true,
      warning,
    };
  }
}
