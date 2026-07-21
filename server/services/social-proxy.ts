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
import { buildScriptPrompt, BASE_RENDER, FORMATS, type AxisKey } from "../../shared/engine-data";
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

// Dịch mô tả khung (tiếng Việt) + phong cách + dàn nhân vật xuất hiện thành 1
// đoạn prompt ẢNH tiếng Anh có cấu trúc — đòn bẩy chất lượng lớn nhất cho VẼ
// vì model ảnh (gemini-3.1-flash-image-preview) hiểu prompt tiếng Anh tốt hơn
// nhiều so với tiếng Việt trực tiếp. Pattern tham khảo tinh thần
// generateImagePromptsFromJson (share-projects/marcow-crop/src/services/gemini.ts)
// — yêu cầu Gemini trả JSON { "prompt": "..." } (vì generateTextGemini luôn ép
// responseMimeType=application/json), rồi lấy field đó ra làm prompt ảnh thô.
// Lỗi bất kỳ (Gemini fail, JSON không parse được, field rỗng) → trả null, KHÔNG
// throw — caller (generateImageVariants) fallback về prompt tiếng Việt gốc.
async function translateSceneToImagePrompt(input: {
  sceneText: string;
  characterNames: string[];
  layoutInstruction: string;
}): Promise<string | null> {
  const prompt = `Bạn là chuyên gia Prompt Engineering cho công cụ tạo ảnh AI (text-to-image). Chuyển mô tả cảnh/truyện tranh (tiếng Việt) dưới đây thành MỘT đoạn prompt ẢNH tiếng Anh chuyên ngành minh hoạ (bối cảnh, hành động, biểu cảm, vị trí + bố cục từng khung).

BỐ CỤC KHUNG (BẮT BUỘC tuân theo — quyết định SỐ KHUNG):
${input.layoutInstruction}

NHÂN VẬT XUẤT HIỆN: ${input.characterNames.join(", ") || "(theo mô tả)"}

MÔ TẢ CẢNH (tiếng Việt):
${input.sceneText}

YÊU CẦU:
- Dịch sang tiếng Anh minh hoạ chuyên ngành, mô tả RÕ từng khung theo đúng bố cục ở trên (nếu 4 khung thì mô tả cả 4 khung + tiến trình câu chuyện qua từng khung).
- Nếu bố cục yêu cầu bám theo ảnh meme mẫu → mô tả tiến trình từng khung khớp với meme đó.
- TUYỆT ĐỐI KHÔNG đưa chữ/thoại/nhãn cần hiển thị lên ảnh (noText — chữ thêm ở hậu kỳ).
- Không giải thích, không markdown.

Chỉ trả về DUY NHẤT JSON dạng { "prompt": "<đoạn prompt ảnh tiếng Anh>" }.`;

  try {
    const text = await generateTextGemini(prompt);
    const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    const value = typeof parsed?.prompt === "string" ? parsed.prompt.trim() : "";
    return value || null;
  } catch {
    return null;
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

export async function generateImageVariants(input: {
  sceneText: string; // mô tả cảnh (tiếng Việt)
  characterNames: string[];
  characterPrompts?: string; // mô tả text các nhân vật (khi không có ảnh ref)
  stylePrompt: string; // phong cách vẽ đã chọn (ART_STYLES[].prompt)
  layoutInstruction: string; // bố cục/số khung đã chọn (PANEL_LAYOUTS[].instruction)
  aspectRatio?: string;
  // PHÂN VAI ảnh tham chiếu — model xử lý khác nhau:
  //  characterRefs: "giữ ĐÚNG khuôn mặt/trang phục/màu" (không vẽ lại thiết kế).
  //  templateRefs : ảnh meme mẫu → "copy BỐ CỤC/số khung/tiến trình" (vẽ lại theo style ta).
  characterRefs?: RefImage[];
  templateRefs?: RefImage[];
}): Promise<GenerateImageResult> {
  const charRefs = input.characterRefs || [];
  const tmplRefs = input.templateRefs || [];

  if (!process.env.GEMINI_API_KEY) {
    const warning = "[social-proxy] GEMINI_API_KEY chưa cấu hình — dùng ảnh placeholder (demo).";
    console.warn(warning);
    return {
      images: [
        { url: placeholderImage(input.characterNames.join(", "), "#D97757"), source: "placeholder" },
        { url: placeholderImage(input.characterNames.join(", "), "#C66545"), source: "placeholder" },
      ],
      isDemo: true,
      warning,
    };
  }

  // Ảnh nhân vật ĐỨNG TRƯỚC, ảnh meme mẫu đứng sau; cắt tối đa 4 (model bão hoà).
  const refs: RefImage[] = [...charRefs, ...tmplRefs].slice(0, 4);

  // Dịch cảnh VN → EN, BÁM theo bố cục đã chọn (quyết định số khung). Lỗi → fallback VN.
  const translated = await translateSceneToImagePrompt({
    sceneText: input.sceneText,
    characterNames: input.characterNames,
    layoutInstruction: input.layoutInstruction,
  });
  const scene = translated || input.sceneText;
  if (!translated) console.warn("[social-proxy] Dịch prompt ảnh VN→EN thất bại — dùng mô tả tiếng Việt gốc (fallback).");

  // Hướng dẫn vai từng loại ảnh tham chiếu (điểm mấu chốt cho đồng bộ nhân vật +
  // bám bố cục meme).
  const charNote = charRefs.length
    ? `CHARACTER CONSISTENCY (critical): the character(s) in EVERY panel must look IDENTICAL to the provided character reference image(s) — same face, hairstyle, costume, colors and body proportions. Do NOT redesign or restyle the characters.`
    : input.characterPrompts
      ? `Characters: ${input.characterPrompts}`
      : "";
  const tmplNote = tmplRefs.length
    ? `LAYOUT TEMPLATE: one provided reference image is a MEME TEMPLATE. Copy its panel layout, number of panels, framing and visual progression EXACTLY — but redraw it in the described art style with our character(s), not the original ones.`
    : "";

  const prompt = [
    input.stylePrompt + ".",
    input.layoutInstruction,
    `SCENE: ${scene}`,
    charNote,
    tmplNote,
    BASE_RENDER,
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    // 2 biến thể độc lập từ cùng 1 prompt (FR4.2) — gọi song song.
    const results = await Promise.all(
      [0, 1].map(async () => ({
        url: await generateImageGemini(prompt, refs.length ? refs : undefined, input.aspectRatio || "1:1"),
        source: "social" as const, // "ảnh Gemini thật" (khác "placeholder")
      }))
    );
    return { images: results, isDemo: false };
  } catch (e: any) {
    const warning = `[social-proxy] Gọi Gemini generate-image thất bại (${e?.message || e}) — dùng ảnh placeholder (demo).`;
    console.warn(warning);
    return {
      images: [
        { url: placeholderImage(input.characterNames.join(", "), "#D97757"), source: "placeholder" },
        { url: placeholderImage(input.characterNames.join(", "), "#C66545"), source: "placeholder" },
      ],
      isDemo: true,
      warning,
    };
  }
}
