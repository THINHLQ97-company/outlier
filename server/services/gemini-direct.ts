// Gọi Gemini TRỰC TIẾP server-side bằng GEMINI_API_KEY — pattern port từ
// share-projects/marcow-crop/server.ts ("/api/gemini" proxy, dùng @google/genai
// phía server). Khác marcow-crop ở chỗ KHÔNG có route proxy generic nhận
// model/contents tuỳ ý từ client — 2 hàm dưới đây là API nội bộ duy nhất, được
// gọi từ server/services/social-proxy.ts (DỊCH/VẼ) và
// server/routes/characters.routes.ts (AI vẽ ảnh reference). API key KHÔNG BAO
// GIỜ đi tới client.
//
// Model dùng đúng tên marcow-crop đang chạy production:
//   text  → "gemini-3.1-pro-preview"
//   image → "gemini-3.1-flash-image-preview" (imageConfig.imageSize = "1K")
//
// Thiếu GEMINI_API_KEY hoặc lỗi gọi API → throw GeminiError với message rõ
// ràng (KHÔNG tự fallback ở đây) — nơi gọi (social-proxy.ts,
// characters.routes.ts) chịu trách nhiệm try/catch + fallback demo, giữ đúng
// tinh thần "không crash toàn app" (CLAUDE.md mục 3).
export class GeminiError extends Error {}

const TEXT_MODEL = "gemini-3.1-pro-preview";
const IMAGE_MODEL = "gemini-3.1-flash-image-preview";

function getApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new GeminiError("Thiếu GEMINI_API_KEY trên server — chưa cấu hình tích hợp Gemini trực tiếp.");
  }
  return key;
}

// Chuẩn hoá lỗi từ @google/genai thành message tiếng Việt dễ hiểu, cùng
// pattern with marcow-crop's /api/gemini error handling.
function normalizeGeminiError(e: any): GeminiError {
  const msg: string = e?.message || String(e);
  if (msg.includes("API key not valid") || msg.includes("API_KEY_INVALID")) {
    return new GeminiError("API Key Gemini không hợp lệ. Vui lòng kiểm tra GEMINI_API_KEY trong .env.");
  }
  if (msg.includes("quota") || msg.includes("429")) {
    return new GeminiError("Đã hết quota API Gemini. Vui lòng chờ hoặc nâng cấp plan.");
  }
  return new GeminiError(`Gọi Gemini API thất bại: ${msg}`);
}

// Đổi 2026-09-18: khoá API hiện tại KHÔNG còn truy cập được text-embedding-004
// (đã kiểm tra bằng /v1beta/models). Bản thay thế còn phục vụ: gemini-embedding-001.
// Lưu ý: số chiều vector khác bản cũ, nên các vector RAG cũ (nếu có) cần dựng lại
// bằng "Cập nhật hồ sơ" ở mục Thư viện.
const EMBED_MODEL = process.env.GEMINI_EMBED_MODEL || "gemini-embedding-001";

// Sinh embedding (vector) cho 1 đoạn text — dùng cho RAG (truy hồi ảnh đã thích
// giống nhất). Lỗi/thiếu key → throw GeminiError (caller tự bỏ qua RAG).
export async function embedTextGemini(text: string): Promise<number[]> {
  const apiKey = getApiKey();
  try {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey });
    const response: any = await ai.models.embedContent({ model: EMBED_MODEL, contents: text });
    const values = response?.embeddings?.[0]?.values || response?.embedding?.values;
    if (!Array.isArray(values) || values.length === 0) throw new Error("Embedding rỗng.");
    return values as number[];
  } catch (e: any) {
    if (e instanceof GeminiError) throw e;
    throw normalizeGeminiError(e);
  }
}

// DỊCH — sinh text (kịch bản). Trả về text thô (caller tự parse JSON nếu cần,
// xem buildScriptPrompt trong shared/engine-data.ts).
/**
 * Sinh text. Mặc định ép JSON vì phần lớn nơi gọi cần dữ liệu có cấu trúc
 * (chấm điểm rubric, bóc hồ sơ brand, bóc cấu trúc video).
 *
 * Truyền `asPlainText: true` khi cần VĂN BẢN THUẦN cho người đọc — ví dụ bản
 * viết lại cho thương hiệu. Ép JSON ở đó khiến model gói nội dung vào
 * {"content": "..."} và người dùng không copy dùng được.
 */
export async function generateTextGemini(prompt: string, opts: { asPlainText?: boolean } = {}): Promise<string> {
  const apiKey = getApiKey();
  try {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: TEXT_MODEL,
      contents: prompt,
      config: opts.asPlainText ? {} : { responseMimeType: "application/json" },
    });
    const text = response.text;
    if (!text) throw new Error("Phản hồi Gemini rỗng.");
    return text;
  } catch (e: any) {
    if (e instanceof GeminiError) throw e;
    throw normalizeGeminiError(e);
  }
}

// PHÂN TÍCH ẢNH (vision) — gửi ảnh + prompt tới model text đa phương thức
// (gemini-3.1-pro-preview nhận ảnh), ép responseMimeType JSON, trả về text JSON
// thô (caller tự parse). Dùng để "đọc" một ảnh phong cách vẽ và mô tả lại thành
// styleJson có cấu trúc (server/routes/styles.routes.ts). Thiếu key / lỗi API →
// throw GeminiError (caller chịu trách nhiệm fallback, KHÔNG crash).
export async function analyzeImageGemini(
  prompt: string,
  image: { mimeType: string; data: string }
): Promise<string> {
  const apiKey = getApiKey();
  try {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: TEXT_MODEL,
      contents: { parts: [{ inlineData: image }, { text: prompt }] },
      config: { responseMimeType: "application/json" },
    });
    const text = response.text;
    if (!text) throw new Error("Phản hồi Gemini rỗng.");
    return text;
  } catch (e: any) {
    if (e instanceof GeminiError) throw e;
    throw normalizeGeminiError(e);
  }
}

// XEM VIDEO — gửi cả tệp video cho Gemini để bóc cấu trúc nội dung
// (server/services/deconstruct.ts). Dùng inlineData giống analyzeImageGemini;
// Gemini nhận video tối đa ~20MB theo đường inline, video lớn hơn phải dùng
// Files API — caller chịu trách nhiệm giới hạn kích thước trước khi gọi.
// Thiếu key / lỗi API → throw GeminiError (caller fallback, KHÔNG crash).
export async function analyzeVideoGemini(
  prompt: string,
  video: { mimeType: string; data: string }
): Promise<string> {
  const apiKey = getApiKey();
  try {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: TEXT_MODEL,
      contents: { parts: [{ inlineData: video }, { text: prompt }] },
      config: { responseMimeType: "application/json" },
    });
    const text = response.text;
    if (!text) throw new Error("Phản hồi Gemini rỗng.");
    return text;
  } catch (e: any) {
    if (e instanceof GeminiError) throw e;
    throw normalizeGeminiError(e);
  }
}

// VẼ — sinh ảnh, trả về data URL base64 (data:image/png;base64,...).
// referenceImages: ảnh nhân vật tham chiếu (thư viện Nhân vật) đính kèm để
// giữ đúng ngoại hình đã duyệt (mục 2.4 v3.md).
export async function generateImageGemini(
  prompt: string,
  referenceImages?: { mimeType: string; data: string }[],
  aspectRatio: string = "1:1"
): Promise<string> {
  const apiKey = getApiKey();
  try {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey });
    const parts: any[] = [];
    for (const ref of referenceImages || []) {
      parts.push({ inlineData: ref });
    }
    parts.push({ text: prompt });

    const response = await ai.models.generateContent({
      model: IMAGE_MODEL,
      contents: { parts },
      config: {
        imageConfig: { aspectRatio: aspectRatio as any, imageSize: "1K" },
      },
    });

    const responseParts = response.candidates?.[0]?.content?.parts || [];
    for (const part of responseParts as any[]) {
      if (part.inlineData) {
        return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
      }
    }
    throw new Error("Phản hồi Gemini không chứa ảnh.");
  } catch (e: any) {
    if (e instanceof GeminiError) throw e;
    throw normalizeGeminiError(e);
  }
}
