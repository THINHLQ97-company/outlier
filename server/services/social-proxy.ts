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

// Dịch mô tả khung (tiếng Việt) + phong cách + dàn nhân vật xuất hiện thành 1
// đoạn prompt ẢNH tiếng Anh có cấu trúc — đòn bẩy chất lượng lớn nhất cho VẼ
// vì model ảnh (gemini-3.1-flash-image-preview) hiểu prompt tiếng Anh tốt hơn
// nhiều so với tiếng Việt trực tiếp. Pattern tham khảo tinh thần
// generateImagePromptsFromJson (share-projects/marcow-crop/src/services/gemini.ts)
// — yêu cầu Gemini trả JSON { "prompt": "..." } (vì generateTextGemini luôn ép
// responseMimeType=application/json), rồi lấy field đó ra làm prompt ảnh thô.
// Lỗi bất kỳ (Gemini fail, JSON không parse được, field rỗng) → trả null, KHÔNG
// throw — caller (generateImageVariants) fallback về prompt tiếng Việt gốc.
async function translatePanelsToImagePrompt(input: {
  styleSummary: string;
  panelsText: string;
  characterNames: string[];
}): Promise<string | null> {
  const prompt = `Bạn là chuyên gia Prompt Engineering cho công cụ tạo ảnh AI (text-to-image). Nhiệm vụ: chuyển mô tả khung truyện tranh (tiếng Việt) dưới đây thành MỘT đoạn prompt ẢNH tiếng Anh duy nhất, chuyên ngành minh hoạ/truyện tranh (bối cảnh, bố cục khung, hành động, biểu cảm, vị trí nhân vật).

PHONG CÁCH + DÀN NHÂN VẬT (đã có mô tả tiếng Anh, giữ nguyên tinh thần):
${input.styleSummary}

NHÂN VẬT XUẤT HIỆN TRONG KHUNG NÀY: ${input.characterNames.join(", ") || "(không xác định)"}

MÔ TẢ KHUNG (tiếng Việt, có thể gồm nhiều khung, tối đa 2):
${input.panelsText}

YÊU CẦU BẮT BUỘC:
- Dịch bối cảnh/hành động/biểu cảm/bố cục sang tiếng Anh chuyên ngành minh hoạ.
- Mô tả rõ số khung (1 hoặc 2 panel), bố cục từng khung, nhân vật nào xuất hiện, đang làm gì, biểu cảm gì.
- Giữ nguyên phong cách nghệ thuật đã mô tả ở trên (đưa vào đầu đoạn prompt).
- TUYỆT ĐỐI KHÔNG đưa bất kỳ chữ/thoại/nhãn/text nào cần hiển thị trên ảnh vào prompt — chữ sẽ được thêm ở hậu kỳ (noText).
- Không thêm giải thích, không markdown.

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

export async function generateImageVariants(input: {
  styleSummary: string;
  panelsText: string;
  characterNames: string[];
  aspectRatio?: string;
  // Ảnh nhân vật tham chiếu (thư viện Nhân vật) — đính vào Gemini để giữ đúng
  // ngoại hình đã duyệt (image-to-image, mục 2.4 v3.md). Rỗng → chỉ dựa text.
  referenceImages?: { mimeType: string; data: string }[];
}): Promise<GenerateImageResult> {
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

  const refs = input.referenceImages || [];

  // B2.1 — dịch mô tả khung VN → 1 prompt ảnh EN có cấu trúc trước khi vẽ (đòn
  // bẩy chất lượng lớn nhất). Lỗi bước dịch → fallback về prompt VN cũ,
  // console.warn, KHÔNG làm hỏng cả lượt sinh ảnh.
  const translated = await translatePanelsToImagePrompt({
    styleSummary: input.styleSummary,
    panelsText: input.panelsText,
    characterNames: input.characterNames,
  });

  let prompt: string;
  if (translated) {
    const refNoteEn = refs.length
      ? `\n\nKeep the EXACT appearance of the characters as shown in the ${refs.length} attached reference image(s) (do not change outfit/colors/identity).`
      : "";
    prompt = `${input.styleSummary}\n\n${translated}${refNoteEn}\n\nDo NOT render any text/dialogue/labels on the image (noText) — text will be added later in post-production.`;
  } else {
    console.warn("[social-proxy] Dịch prompt ảnh VN→EN thất bại — dùng prompt tiếng Việt gốc (fallback).");
    const refNote = refs.length
      ? `\n\nGiữ ĐÚNG ngoại hình các nhân vật theo ${refs.length} ảnh tham chiếu đính kèm (không đổi trang phục/màu/nhận diện).`
      : "";
    prompt = `${input.styleSummary}\n\n${input.panelsText}${refNote}\n\nKHÔNG vẽ chữ/thoại lên ảnh (noText) — chữ sẽ được thêm ở hậu kỳ.`;
  }

  try {
    // 2 biến thể độc lập từ cùng 1 prompt (FR4.2) — gọi song song.
    const results = await Promise.all(
      [0, 1].map(async () => ({
        url: await generateImageGemini(prompt, refs.length ? refs : undefined, input.aspectRatio || "1:1"),
        source: "social" as const, // nghĩa là "ảnh Gemini thật" (khác "placeholder"), không còn liên quan share-projects/social
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
