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

/**
 * Nhờ model đọc bản viết rồi tả ảnh cần vẽ.
 *
 * Tách làm hai bước (tả rồi mới vẽ) thay vì đưa thẳng bản viết cho model vẽ:
 * model vẽ đọc một đoạn dài sẽ bám vào chi tiết vụn, còn bước tả buộc phải chọn
 * ra MỘT khoảnh khắc đáng vẽ. Bước tả cũng là chỗ người dùng sửa được.
 */
export interface SourceContext {
  /** Đọc được gì trong ảnh của bài gốc (chữ trên ảnh, loại ảnh, thủ pháp). */
  imageReading?: { textInImage?: string; imageKind?: string; technique?: string; description?: string } | null;
  /** Công thức triển khai đã bóc được từ bài gốc. */
  formula?: string | null;
  /** Hướng nội dung chủ trang đặt. */
  direction?: string | null;
}

export async function describeImageForDraft(
  draft: string,
  brand: any,
  chars: CharacterRow[] = [],
  source: SourceContext = {},
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

  // Bài gốc quyết định HÌNH THỨC, bản viết quyết định NỘI DUNG.
  //
  // Thiếu phần này là lỗi đã gặp: với trang truyện tranh, hình thức của bài gốc
  // CHÍNH LÀ nội dung — tả ảnh chỉ từ chữ thì ra một tấm minh hoạ chung chung,
  // không liên quan gì tới bài đang remake.
  const r = source.imageReading;
  const sourceLines: string[] = [];
  if (r?.imageKind) sourceLines.push(`Bài gốc là loại ảnh: ${r.imageKind}`);
  if (r?.technique) sourceLines.push(`Bài gốc gây chú ý bằng: ${r.technique}`);
  if (r?.description) sourceLines.push(`Ảnh gốc trông thế nào: ${r.description}`);
  if (r?.textInImage) sourceLines.push(`Chữ nằm trong ảnh gốc: "${r.textInImage.slice(0, 400)}"`);
  if (source.formula) sourceLines.push(`Cách triển khai học được: ${source.formula}`);

  const sourceBlock = sourceLines.length
    ? `BÀI GỐC ĐANG HỌC THEO (bám HÌNH THỨC của nó, KHÔNG chép nội dung):\n${sourceLines.join("\n")}\n\n`
    : "";
  const directionBlock = source.direction?.trim()
    ? `HƯỚNG NỘI DUNG CHỦ TRANG ĐẶT (thắng mọi gợi ý khác): ${source.direction.trim()}\n\n`
    : "";

  const prompt = `Đây là bản viết sắp đăng của một fanpage:

${draft.slice(0, 2000)}

${sourceBlock}${directionBlock}${charBlock}${lines.length ? `Nhận diện hình ảnh của trang:\n${lines.join("\n")}\n` : ""}
Hãy tả MỘT tấm ảnh minh hoạ cho bài này, để đưa cho công cụ vẽ.

Yêu cầu:
- Ảnh phải minh hoạ ĐÚNG nội dung bản viết ở trên — không phải một cảnh chung chung cùng chủ đề.
- Nếu bài gốc là truyện tranh/ảnh nhiều khung, giữ đúng hình thức đó (số khung, cách chia khung), nhưng nội dung từng khung lấy từ bản viết.
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
  /** Đặc tả đã dùng — giao diện hiện ra để xem và sửa. */
  spec?: Record<string, any>;
  /** Nhân vật đã dùng làm mẫu — để giao diện nói rõ ảnh vẽ theo ai. */
  charactersUsed: { id: string; name: string; hasReference: boolean }[];
}

export async function generateRemakeImage(opts: {
  remakeId: string;
  aspectRatio?: string;
  /** Người dùng tự tả, bỏ qua bước nhờ model tả. */
  customPrompt?: string;
  /** Đặc tả người dùng đã sửa tay — vẽ lại đúng theo bản này. */
  spec?: Record<string, any> | null;
  /** Chữ muốn hiện trong ảnh; bỏ trống = không vẽ chữ. */
  textInImage?: string | null;
}): Promise<GenerateRemakeImageResult> {
  const db = getDb();
  const [row] = await db.select().from(remakes).where(eq(remakes.id, opts.remakeId));
  if (!row) throw new Error("Không tìm thấy bản viết.");
  if (!row.draft?.trim()) throw new Error("Bản viết chưa có nội dung — viết xong rồi mới vẽ được.");

  const [brand] = await db.select().from(brands).where(eq(brands.id, row.brandId));
  const chars = await charactersForBrand(row.brandId);

  // Đọc BÀI GỐC: hình thức của nó quyết định hình thức ảnh mình vẽ. Thiếu phần
  // này thì ảnh ra một tấm minh hoạ chung chung không dính gì tới bài đang làm.
  const { deconstructions } = await import("../db/schema");
  const [decon] = row.deconstructionId
    ? await db.select().from(deconstructions).where(eq(deconstructions.id, row.deconstructionId))
    : [];
  const source = {
    imageReading: (decon?.imageReading as any) || null,
    formula: (decon?.structure as any)?.formula || null,
    direction: row.directionText || null,
  };

  const description =
    opts.customPrompt?.trim() || (await describeImageForDraft(row.draft, brand, chars, source));
  const aspectRatio = opts.aspectRatio || "1:1";

  // Đặc tả có cấu trúc thay cho một đoạn mô tả bằng lời: model tuân thủ danh
  // sách mục chắc hơn văn xuôi, và người dùng sửa được đúng mục cần sửa.
  const { buildImageSpec, imageSpecToPrompt, sanitizeSpec } = await import("./image-spec");
  // Gom ảnh mẫu và đánh số cùng một chỗ: tách ra hai nơi là nguồn gốc của lỗi
  // "nhân vật vẽ ra không giống ảnh mẫu" (số hiệu lệch một bậc khi có nhân vật
  // thiếu ảnh).
  const { collectCharacterRefs } = await import("./character-refs");
  const { images: refs, characters: charRefs } = await collectCharacterRefs(chars);
  const baseSpec = buildImageSpec({
    description,
    aspectRatio,
    characters: charRefs,
    visual: visualOf(brand),
    textInImage: opts.textInImage,
  });
  // Người dùng sửa tay thì dùng bản họ sửa, nhưng vẫn lọc lại — không tin dữ
  // liệu gửi lên.
  const spec = opts.spec ? sanitizeSpec(opts.spec, baseSpec) : baseSpec;
  const prompt = imageSpecToPrompt(spec, refs.length);

  // Ảnh mẫu của nhân vật đi kèm prompt: tả bằng chữ không đủ để hai bài ra cùng
  // một nhân vật, phải cho model nhìn thấy.
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
    specJson: spec as any,
    promptSent: prompt,
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
    spec: spec as any,
    charactersUsed: chars.map((c) => ({
      id: c.id,
      name: c.name,
      hasReference: !!internalKeyFromUrl(c.referenceImageUrl),
    })),
  };
}
