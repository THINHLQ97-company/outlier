// Vẽ ảnh cho một bản remake.
//
// Khác với luồng "Sáng tạo" (vẽ meme theo dàn nhân vật cố định Gàn/Gèn), ở đây
// ảnh phải bám nhận diện của THƯƠNG HIỆU người dùng: khuôn ảnh quen thuộc, thứ
// luôn phải có, và nhất là thứ không bao giờ được xuất hiện.
//
// Vì sao phần "không bao giờ xuất hiện" đáng giá nhất: model vẽ rất sẵn lòng
// thêm mặt người, logo lạ, chữ tiếng Anh vào ảnh. Một trang faceless mà ảnh có
// mặt người là hỏng cả bài, dù nội dung đúng.
import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { brands, remakes, type BrandVisualIdentity, type RemakeImage } from "../db/schema";
import { generateImageGemini, generateTextGemini } from "./gemini-direct";
import { persistDataUrl } from "../storage";

function visualOf(brand: any): BrandVisualIdentity | null {
  const f = brand?.visualIdentity;
  return f?.value || null;
}

/**
 * Nhờ model đọc bản viết rồi tả ảnh cần vẽ.
 *
 * Tách làm hai bước (tả rồi mới vẽ) thay vì đưa thẳng bản viết cho model vẽ:
 * model vẽ đọc một đoạn dài sẽ bám vào chi tiết vụn, còn bước tả buộc phải chọn
 * ra MỘT khoảnh khắc đáng vẽ. Bước tả cũng là chỗ người dùng sửa được.
 */
export async function describeImageForDraft(draft: string, brand: any): Promise<string> {
  const visual = visualOf(brand);
  const lines: string[] = [];
  if (visual?.template) lines.push(`Khuôn ảnh quen thuộc của trang: ${visual.template}`);
  if (visual?.mustHave?.length) lines.push(`Luôn phải có: ${visual.mustHave.join("; ")}`);
  if (visual?.doNots?.length) lines.push(`Không bao giờ được xuất hiện: ${visual.doNots.join("; ")}`);
  if (visual?.palette?.length) lines.push(`Màu chủ đạo: ${visual.palette.join(", ")}`);

  const prompt = `Đây là bản viết sắp đăng của một fanpage:

${draft.slice(0, 2000)}

${lines.length ? `Nhận diện hình ảnh của trang:\n${lines.join("\n")}\n` : ""}
Hãy tả MỘT tấm ảnh minh hoạ cho bài này, để đưa cho công cụ vẽ.

Yêu cầu:
- Chọn đúng một khoảnh khắc, không tả cả câu chuyện.
- Tả cụ thể: bố cục, vật thể, góc nhìn, ánh sáng, tâm trạng.
- Nếu trang có khuôn ảnh quen thuộc, bám theo khuôn đó.
- Nếu ảnh cần có chữ, ghi rõ chữ đó là gì, bằng tiếng Việt có dấu.
- Tuyệt đối tránh những thứ trang đã ghi là không được xuất hiện.
- Viết một đoạn liền mạch, không gạch đầu dòng, không giải thích thêm.`;

  return (await generateTextGemini(prompt, { asPlainText: true })).trim();
}

/** Ghép mô tả với ràng buộc của trang thành prompt cuối gửi cho công cụ vẽ. */
export function buildImagePrompt(description: string, brand: any): string {
  const visual = visualOf(brand);
  const parts = [description];

  if (visual?.mustHave?.length) {
    parts.push(`Bắt buộc có trong ảnh: ${visual.mustHave.join("; ")}.`);
  }
  if (visual?.palette?.length) {
    parts.push(`Màu chủ đạo: ${visual.palette.join(", ")}.`);
  }
  // Nhắc lại điều cấm ở CUỐI prompt: phần cuối được model vẽ tuân thủ chắc hơn.
  if (visual?.doNots?.length) {
    parts.push(`Tuyệt đối KHÔNG có: ${visual.doNots.join("; ")}.`);
  }
  parts.push("Chữ trong ảnh (nếu có) phải là tiếng Việt viết đúng dấu.");

  return parts.join(" ");
}

export interface GenerateRemakeImageResult {
  image: RemakeImage;
  description: string;
}

export async function generateRemakeImage(opts: {
  remakeId: string;
  aspectRatio?: string;
  /** Người dùng tự tả, bỏ qua bước nhờ model tả. */
  customPrompt?: string;
}): Promise<GenerateRemakeImageResult> {
  const db = getDb();
  const [row] = await db.select().from(remakes).where(eq(remakes.id, opts.remakeId));
  if (!row) throw new Error("Không tìm thấy bản viết.");
  if (!row.draft?.trim()) throw new Error("Bản viết chưa có nội dung — viết xong rồi mới vẽ được.");

  const [brand] = await db.select().from(brands).where(eq(brands.id, row.brandId));

  const description = opts.customPrompt?.trim() || (await describeImageForDraft(row.draft, brand));
  const prompt = buildImagePrompt(description, brand);
  const aspectRatio = opts.aspectRatio || "1:1";

  const dataUrl = await generateImageGemini(prompt, undefined, aspectRatio);
  // persistDataUrl lưu vào storage rồi trả "/api/files/<key>" — dùng chung cơ
  // chế với ảnh của luồng Sáng tạo, thay vì nhét base64 vào Postgres.
  const url = await persistDataUrl("remakes", dataUrl);
  if (!url) throw new Error("Công cụ vẽ trả về dữ liệu không đọc được.");

  const image: RemakeImage = {
    url,
    prompt: description,
    aspectRatio,
    createdAt: new Date().toISOString(),
  };

  const images = [...((row.imagesJson as RemakeImage[]) || []), image];
  await db
    .update(remakes)
    // Ảnh mới vẽ được chọn luôn: gần như lúc nào người dùng cũng muốn dùng cái
    // vừa ra, còn muốn quay lại ảnh cũ thì bấm chọn.
    .set({ imagesJson: images, selectedImageUrl: url, updatedAt: new Date() })
    .where(eq(remakes.id, opts.remakeId));

  return { image, description };
}
