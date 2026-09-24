// Đọc nội dung nằm TRONG ảnh của một bài.
//
// Vì sao cần: với fanpage giải trí, phần lớn nội dung nằm ở ảnh chứ không ở
// caption — meme, ảnh chụp đoạn chat, infographic, ảnh có chữ đè lên. Caption
// nhiều khi chỉ là một dòng dẫn. Đánh giá bài bằng độ dài caption là đo nhầm
// chỗ, và bóc cấu trúc mà bỏ qua ảnh thì bỏ sót đúng phần hay nhất.
//
// Hai thứ lấy ra, và chúng khác nhau:
//   - CHỮ trong ảnh: nguyên văn, để biết bài thật sự nói gì
//   - CÁCH DỰNG ảnh: bố cục, thủ pháp gây chú ý, vì sao dừng mắt — thứ đem đi
//     học được, giống như cách triển khai của phần chữ
import { analyzeImageGemini } from "./gemini-direct";

const FETCH_TIMEOUT_MS = 20_000;
/** Ảnh quá lớn thì nén đường truyền lẫn hạn mức; 8MB là quá đủ cho ảnh mạng xã hội. */
const MAX_BYTES = 8 * 1024 * 1024;

export interface ImageReading {
  /** Chữ xuất hiện trong ảnh, giữ nguyên văn. Rỗng nếu ảnh không có chữ. */
  textInImage: string;
  /** Ảnh vẽ gì, bố cục ra sao. */
  description: string;
  /** Cách ảnh gây chú ý — thứ đem đi học được. */
  technique: string;
  /** meme | anh_chat | infographic | anh_that | do_hoa | khac */
  imageKind: string;
  /** Ảnh có phải nơi chứa nội dung chính không, hay chỉ minh hoạ. */
  carriesMainContent: boolean;
}

const PROMPT = `Đây là ảnh của một bài đăng mạng xã hội. Hãy đọc kỹ và trả về JSON:

{
  "textInImage": "toàn bộ chữ xuất hiện trong ảnh, giữ NGUYÊN VĂN, xuống dòng như trong ảnh. Không có chữ thì để chuỗi rỗng.",
  "description": "ảnh vẽ/chụp gì, bố cục ra sao, ai đang làm gì",
  "technique": "ảnh này gây chú ý bằng cách nào — thủ pháp khiến người lướt phải dừng lại",
  "imageKind": "meme" | "anh_chat" | "infographic" | "anh_that" | "do_hoa" | "khac",
  "carriesMainContent": true nếu nội dung chính của bài nằm trong ảnh (meme có chữ, ảnh chat, infographic); false nếu ảnh chỉ minh hoạ cho phần caption
}

Quy tắc:
- "textInImage" phải là chữ CÓ THẬT trong ảnh. Không đoán, không dịch, không tóm tắt. Đọc được bao nhiêu ghi bấy nhiêu.
- Nếu ảnh mờ hoặc không đọc được chữ, để "textInImage" rỗng và nói rõ trong "description".
- "technique" nói về CÁCH DỰNG (bố cục, tương phản, chỗ đặt chữ, biểu cảm), không kể lại nội dung.
- Trả về ĐÚNG JSON, không thêm lời dẫn.`;

/** Tải ảnh về dạng base64. Trả null nếu không lấy được — không ném lỗi. */
async function fetchImageAsBase64(url: string): Promise<{ mimeType: string; data: string } | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;

    const type = res.headers.get("content-type") || "image/jpeg";
    if (!type.startsWith("image/")) return null;

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_BYTES) return null;

    return { mimeType: type.split(";")[0], data: buf.toString("base64") };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Đọc ảnh đã có sẵn trong bộ nhớ — dùng cho ảnh người dùng tự tải lên.
 * Tách khỏi readImage vì ảnh tải lên không có đường dẫn công khai để tải về.
 */
export async function readImageData(img: { mimeType: string; data: string }): Promise<ImageReading | null> {
  return analyzeAndParse(img);
}

export async function readImage(imageUrl: string): Promise<ImageReading | null> {
  const img = await fetchImageAsBase64(imageUrl);
  if (!img) return null;
  return analyzeAndParse(img);
}

async function analyzeAndParse(img: { mimeType: string; data: string }): Promise<ImageReading | null> {

  let raw: string;
  try {
    raw = await analyzeImageGemini(PROMPT, img);
  } catch {
    // Đọc ảnh hỏng không được làm hỏng cả lượt bóc cấu trúc — phần chữ vẫn dùng được.
    return null;
  }

  try {
    const d = JSON.parse(raw);
    const kinds = ["meme", "anh_chat", "infographic", "anh_that", "do_hoa", "khac"];
    return {
      textInImage: String(d?.textInImage || "").trim(),
      description: String(d?.description || "").trim(),
      technique: String(d?.technique || "").trim(),
      imageKind: kinds.includes(d?.imageKind) ? d.imageKind : "khac",
      carriesMainContent: !!d?.carriesMainContent,
    };
  } catch {
    return null;
  }
}

const KIND_LABEL: Record<string, string> = {
  meme: "ảnh chế",
  anh_chat: "ảnh chụp đoạn chat",
  infographic: "đồ hoạ thông tin",
  anh_that: "ảnh chụp thật",
  do_hoa: "ảnh thiết kế",
  khac: "ảnh",
};

/** Viết thành mấy dòng để nhét vào prompt bóc cấu trúc và remake. */
export function imageReadingToText(r: ImageReading): string {
  const lines = [`Ảnh của bài (${KIND_LABEL[r.imageKind] || "ảnh"}):`];
  if (r.textInImage) {
    lines.push(`Chữ trong ảnh:\n"""\n${r.textInImage}\n"""`);
  }
  if (r.description) lines.push(`Ảnh vẽ gì: ${r.description}`);
  if (r.technique) lines.push(`Ảnh gây chú ý bằng: ${r.technique}`);
  if (r.carriesMainContent) {
    // Nói thẳng ra, vì đây là thứ đổi cách đọc cả bài: caption ngắn không có
    // nghĩa là bài nghèo nội dung.
    lines.push("Nội dung chính của bài nằm TRONG ẢNH, không phải ở caption.");
  }
  return lines.join("\n");
}

/** Tổng lượng nội dung thật của bài, tính cả chữ trong ảnh. */
export function totalContentLength(caption: string | null | undefined, reading: ImageReading | null): number {
  return (caption || "").trim().length + (reading?.textInImage?.trim().length || 0);
}
