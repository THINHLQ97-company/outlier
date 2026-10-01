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
import { generateImageGemini } from "./gemini-direct";
import { persistDataUrl } from "../storage";

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
// Đã bỏ describeImageForDraft + buildImagePrompt (2026-10-01): hai hàm đó tả
// ảnh bằng MỘT đoạn văn xuôi và đưa cả ngoại hình nhân vật bằng chữ vào prompt.
// Chữ ngoại hình giành quyền với ảnh mẫu, nên nhân vật vẽ ra không giống ảnh
// mẫu. Thay bằng image-concepts.ts: phương án có cấu trúc theo khung, chỉ tả
// hành động/biểu cảm, ngoại hình để ảnh mẫu lo.

export interface GenerateRemakeImageResult {
  image: RemakeImage;
  description: string;
  /** Đặc tả đã dùng — giao diện hiện ra để xem và sửa. */
  spec?: Record<string, any>;
  /** Nhân vật đã dùng làm mẫu — để giao diện nói rõ ảnh vẽ theo ai. */
  charactersUsed: { id: string; name: string; hasReference: boolean }[];
}

/**
 * Nguyên liệu chung cho việc đề xuất phương án và vẽ: thương hiệu, nhân vật
 * (kèm ảnh mẫu đã đánh số), và bài gốc.
 */
async function loadImageContext(remakeId: string) {
  const db = getDb();
  const [row] = await db.select().from(remakes).where(eq(remakes.id, remakeId));
  if (!row) throw new Error("Không tìm thấy bản viết.");
  if (!row.draft?.trim()) throw new Error("Bản viết chưa có nội dung — viết xong rồi mới vẽ được.");

  const [brand] = await db.select().from(brands).where(eq(brands.id, row.brandId));
  const chars = await charactersForBrand(row.brandId);

  // Đọc BÀI GỐC: hình thức của nó quyết định hình thức ảnh mình vẽ.
  const { deconstructions } = await import("../db/schema");
  const [decon] = row.deconstructionId
    ? await db.select().from(deconstructions).where(eq(deconstructions.id, row.deconstructionId))
    : [];

  // Gom ảnh mẫu và đánh số cùng một chỗ — tách ra là số hiệu lệch.
  const { collectCharacterRefs } = await import("./character-refs");
  const refs = await collectCharacterRefs(chars);

  return {
    db,
    row,
    brand,
    chars,
    refs,
    source: {
      imageReading: (decon?.imageReading as any) || null,
      formula: (decon?.structure as any)?.formula || null,
      direction: row.directionText || null,
    },
  };
}

/**
 * Đề xuất BA phương án ảnh rồi lưu vào bản viết.
 *
 * Tách khỏi việc vẽ: đề xuất là việc chữ (rẻ), vẽ mới tốn tiền. Có sẵn ba
 * phương án thì đổi sang phương án khác chỉ là một cú bấm, không chờ đề xuất lại.
 */
export async function proposeConceptsForRemake(remakeId: string, count = 3) {
  const ctx = await loadImageContext(remakeId);
  const { proposeImageConcepts } = await import("./image-concepts");
  const concepts = await proposeImageConcepts(
    {
      draft: ctx.row.draft!,
      characterNames: ctx.chars.map((c) => c.name),
      // Chỉ nhân vật KHÔNG có ảnh mẫu mới được tả ngoại hình bằng chữ — có ảnh
      // mẫu mà còn tả bằng chữ thì chữ giành quyền với ảnh, nhân vật vẽ ra sai.
      charactersWithoutReference: ctx.refs.characters
        .filter((c) => !c.refIndex && c.promptDescription)
        .map((c) => ({ name: c.name, appearance: c.promptDescription! })),
      visual: visualOf(ctx.brand),
      source: ctx.source,
    },
    count,
  );
  await ctx.db
    .update(remakes)
    .set({ imageConceptsJson: concepts as any, updatedAt: new Date() })
    .where(eq(remakes.id, remakeId));
  return concepts;
}

export async function generateRemakeImage(opts: {
  remakeId: string;
  aspectRatio?: string;
  /** Vẽ theo phương án thứ mấy (0-based). Mặc định phương án đầu. */
  conceptIndex?: number;
  /** Người dùng tự tả, bỏ qua phương án AI đề xuất. */
  customPrompt?: string;
  /** Đặc tả người dùng đã sửa tay — vẽ lại đúng theo bản này. */
  spec?: Record<string, any> | null;
  /** Chữ muốn hiện trong ảnh; bỏ trống = không vẽ chữ. */
  textInImage?: string | null;
}): Promise<GenerateRemakeImageResult> {
  const ctx = await loadImageContext(opts.remakeId);
  const { db, row, brand, chars, refs } = ctx;
  const aspectRatio = opts.aspectRatio || "1:1";

  const { buildImageSpec, specFromConcept, imageSpecToPrompt, sanitizeSpec } = await import("./image-spec");
  const specInput = { aspectRatio, characters: refs.characters, visual: visualOf(brand) };

  let baseSpec;
  let description: string;
  let conceptIndex: number | null = null;

  if (opts.customPrompt?.trim()) {
    // Người dùng tự tả cả cảnh: tôn trọng nguyên văn.
    description = opts.customPrompt.trim();
    baseSpec = buildImageSpec({ ...specInput, description, textInImage: opts.textInImage });
  } else {
    // Mặc định đi qua PHƯƠNG ÁN có cấu trúc (khung, hành động, biểu cảm, lời
    // thoại) — chính xác hơn hẳn một đoạn tả bằng văn xuôi.
    let concepts = Array.isArray(row.imageConceptsJson) ? (row.imageConceptsJson as any[]) : [];
    if (concepts.length === 0) concepts = await proposeConceptsForRemake(opts.remakeId);

    conceptIndex = Math.min(Math.max(0, opts.conceptIndex ?? 0), concepts.length - 1);
    const concept = concepts[conceptIndex];
    description = `${concept.title} — ${concept.why || ""}`.trim();
    baseSpec = specFromConcept(concept, specInput);
  }

  // Người dùng sửa tay đặc tả thì dùng bản họ sửa, nhưng vẫn lọc lại.
  const spec = opts.spec ? sanitizeSpec(opts.spec, baseSpec) : baseSpec;
  const prompt = imageSpecToPrompt(spec, refs.images.length);

  // Ảnh mẫu đi kèm prompt: tả bằng chữ không đủ để hai bài ra cùng một nhân vật.
  const dataUrl = await generateImageGemini(prompt, refs.images.length ? refs.images : undefined, aspectRatio);
  const url = await persistDataUrl("remakes", dataUrl);
  if (!url) throw new Error("Công cụ vẽ trả về dữ liệu không đọc được.");

  const image: RemakeImage = {
    url,
    prompt: description,
    aspectRatio,
    createdAt: new Date().toISOString(),
    specJson: spec as any,
    promptSent: prompt,
    conceptIndex,
  };

  // Đọc lại trước khi ghi: vẽ mất vài chục giây, trong lúc đó có thể đã có ảnh
  // khác được thêm (vd người dùng bấm vẽ phương án khác) — ghi đè là mất ảnh.
  const [fresh] = await db.select().from(remakes).where(eq(remakes.id, opts.remakeId));
  const images = [...((fresh?.imagesJson as RemakeImage[]) || []), image];
  await db
    .update(remakes)
    // Ảnh mới vẽ được chọn luôn: gần như lúc nào người dùng cũng muốn dùng cái vừa ra.
    .set({ imagesJson: images, selectedImageUrl: url, updatedAt: new Date() })
    .where(eq(remakes.id, opts.remakeId));

  return {
    image,
    description,
    spec: spec as any,
    charactersUsed: chars.map((c) => ({
      id: c.id,
      name: c.name,
      hasReference: !!refs.characters.find((r) => r.name === c.name)?.refIndex,
    })),
  };
}
