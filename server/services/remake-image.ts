// Vẽ ảnh cho một bản remake.
//
// Khác với luồng "Sáng tạo" (vẽ meme theo dàn nhân vật cố định Gàn/Gèn), ở đây
// ảnh phải bám nhận diện của THƯƠNG HIỆU người dùng: khuôn ảnh quen thuộc, thứ
// luôn phải có, và nhất là thứ không bao giờ được xuất hiện.
//
// Vì sao phần "không bao giờ xuất hiện" đáng giá nhất: model vẽ rất sẵn lòng
// thêm mặt người, logo lạ, chữ tiếng Anh vào ảnh. Một trang faceless mà ảnh có
// mặt người là hỏng cả bài, dù nội dung đúng.
import { eq, inArray } from "drizzle-orm";
import { getDb } from "../db/client";
import { brandFanpages, brands, characters, remakes, type BrandVisualIdentity, type CharacterRow, type RemakeImage } from "../db/schema";
import { generateImageGemini, generateTextGemini } from "./gemini-direct";
import { persistDataUrl, internalKeyFromUrl, storage } from "../storage";

function visualOf(brand: any): BrandVisualIdentity | null {
  const f = brand?.visualIdentity;
  return f?.value || null;
}

/**
 * Nhân vật gắn với các trang của thương hiệu này.
 *
 * Ưu tiên trang chính: một thương hiệu có thể có nhiều trang với nhân vật khác
 * nhau, và vẽ lẫn nhân vật của trang khác vào còn tệ hơn không có nhân vật nào.
 */
export async function charactersForBrand(brandId: string): Promise<CharacterRow[]> {
  const db = getDb();
  const pages = await db.select().from(brandFanpages).where(eq(brandFanpages.brandId, brandId));
  const primary = pages.find((p) => p.isPrimary && (p.characterIds || []).length > 0);
  const anyPage = pages.find((p) => (p.characterIds || []).length > 0);
  const ids = ((primary || anyPage)?.characterIds || []) as string[];
  if (ids.length === 0) return [];
  return db.select().from(characters).where(inArray(characters.id, ids));
}

/** Đọc ảnh tham chiếu của nhân vật từ storage để đưa vào làm mẫu khi vẽ. */
async function referenceImagesOf(chars: CharacterRow[]): Promise<{ mimeType: string; data: string }[]> {
  const out: { mimeType: string; data: string }[] = [];
  // Trần 3 ảnh: đưa quá nhiều mẫu thì model pha trộn thành một nhân vật lai.
  for (const c of chars.slice(0, 3)) {
    const key = internalKeyFromUrl(c.referenceImageUrl);
    if (!key) continue;
    try {
      const buf = await storage.get(key);
      out.push({ mimeType: "image/png", data: buf.toString("base64") });
    } catch {
      // Thiếu ảnh mẫu thì vẫn vẽ được, chỉ kém nhất quán hơn — không chặn.
    }
  }
  return out;
}

/**
 * Nhờ model đọc bản viết rồi tả ảnh cần vẽ.
 *
 * Tách làm hai bước (tả rồi mới vẽ) thay vì đưa thẳng bản viết cho model vẽ:
 * model vẽ đọc một đoạn dài sẽ bám vào chi tiết vụn, còn bước tả buộc phải chọn
 * ra MỘT khoảnh khắc đáng vẽ. Bước tả cũng là chỗ người dùng sửa được.
 */
export async function describeImageForDraft(
  draft: string,
  brand: any,
  chars: CharacterRow[] = [],
): Promise<string> {
  const visual = visualOf(brand);
  const lines: string[] = [];
  if (visual?.template) lines.push(`Khuôn ảnh quen thuộc của trang: ${visual.template}`);
  if (visual?.mustHave?.length) lines.push(`Luôn phải có: ${visual.mustHave.join("; ")}`);
  if (visual?.doNots?.length) lines.push(`Không bao giờ được xuất hiện: ${visual.doNots.join("; ")}`);
  if (visual?.palette?.length) lines.push(`Màu chủ đạo: ${visual.palette.join(", ")}`);

  const charBlock = chars.length
    ? `Nhân vật đại diện của trang (ảnh phải có nhân vật này):\n` +
      chars
        .map((c) => `- ${c.name}: ${c.promptDescription}${c.personality ? ` (tính cách: ${c.personality})` : ""}`)
        .join("\n") +
      "\n"
    : "";

  const prompt = `Đây là bản viết sắp đăng của một fanpage:

${draft.slice(0, 2000)}

${charBlock}${lines.length ? `Nhận diện hình ảnh của trang:\n${lines.join("\n")}\n` : ""}
Hãy tả MỘT tấm ảnh minh hoạ cho bài này, để đưa cho công cụ vẽ.

Yêu cầu:
- Chọn đúng một khoảnh khắc, không tả cả câu chuyện.
- Tả cụ thể: bố cục, vật thể, góc nhìn, ánh sáng, tâm trạng.
- Nếu trang có khuôn ảnh quen thuộc, bám theo khuôn đó.
- Nếu trang có nhân vật đại diện, nhân vật đó phải xuất hiện và giữ đúng ngoại hình đã tả.
- Nếu ảnh cần có chữ, ghi rõ chữ đó là gì, bằng tiếng Việt có dấu.
- Tuyệt đối tránh những thứ trang đã ghi là không được xuất hiện.
- Viết một đoạn liền mạch, không gạch đầu dòng, không giải thích thêm.`;

  return (await generateTextGemini(prompt, { asPlainText: true })).trim();
}

/** Ghép mô tả với ràng buộc của trang thành prompt cuối gửi cho công cụ vẽ. */
export function buildImagePrompt(description: string, brand: any, chars: CharacterRow[] = []): string {
  const visual = visualOf(brand);
  const parts = [description];

  if (chars.length) {
    parts.push(
      `Nhân vật trong ảnh: ${chars.map((c) => `${c.name} — ${c.promptDescription}`).join(" | ")}. ` +
        `Giữ đúng ngoại hình nhân vật như ảnh mẫu kèm theo.`,
    );
  }

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
  /** Nhân vật đã dùng làm mẫu — để giao diện nói rõ ảnh vẽ theo ai. */
  charactersUsed: { id: string; name: string; hasReference: boolean }[];
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
  const chars = await charactersForBrand(row.brandId);

  const description =
    opts.customPrompt?.trim() || (await describeImageForDraft(row.draft, brand, chars));
  const prompt = buildImagePrompt(description, brand, chars);
  const aspectRatio = opts.aspectRatio || "1:1";

  // Ảnh mẫu của nhân vật đi kèm prompt: tả bằng chữ không đủ để hai bài ra cùng
  // một nhân vật, phải cho model nhìn thấy.
  const refs = await referenceImagesOf(chars);
  const dataUrl = await generateImageGemini(prompt, refs.length ? refs : undefined, aspectRatio);
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

  return {
    image,
    description,
    charactersUsed: chars.map((c) => ({
      id: c.id,
      name: c.name,
      hasReference: !!internalKeyFromUrl(c.referenceImageUrl),
    })),
  };
}
