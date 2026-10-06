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
  charactersUsed: { id: string; name: string; hasReference: boolean; missingReason?: string }[];
  /** Ảnh gốc của bài có được đính kèm làm mẫu bố cục không. */
  sourceAttached?: boolean;
  sourceMissingReason?: string;
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

  // Ảnh gốc của bài: ưu tiên bản đã giữ trong kho (không hết hạn), rồi mới tới
  // link gốc. Link Facebook có chữ ký và hạn dùng, để lâu là không tải được.
  let sourceImageUrl: string | null = (decon?.thumbnailUrl as string) || null;
  if (decon?.radarItemId) {
    const { radarItems } = await import("../db/schema");
    const [item] = await db.select().from(radarItems).where(eq(radarItems.id, decon.radarItemId));
    if (item?.coverUrl?.startsWith("/api/files/")) sourceImageUrl = item.coverUrl;
  }

  // Nét vẽ của trang. Thiếu thì model vẽ theo nét mặc định của nó — nhân vật
  // đúng mà nhìn vẫn không ra trang mình.
  let style: { name: string; styleJson: Record<string, any> } | null = null;
  if (brand?.defaultStyleId) {
    const { styles } = await import("../db/schema");
    const [st] = await db.select().from(styles).where(eq(styles.id, brand.defaultStyleId));
    if (st) style = { name: st.name, styleJson: (st.styleJson as any) || {} };
  }

  return {
    db,
    row,
    brand,
    chars,
    style,
    decon,
    sourceImageUrl,
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
  // Trang hay đăng thể loại gì: khuôn ảnh quen + định dạng trang tự khai. Thể
  // loại hợp trang được xếp đầu — trang sống bằng ảnh chat thì chat lên trước.
  const pageFormatHints: string[] = [];
  const v = visualOf(ctx.brand);
  if (v?.template) pageFormatHints.push(`Khuôn ảnh quen của trang: ${v.template}`);
  const pages = await ctx.db.select().from(brandFanpages).where(eq(brandFanpages.brandId, ctx.row.brandId));
  const declared = [...new Set(pages.flatMap((pg) => (pg.formats as string[]) || []))];
  if (declared.length) pageFormatHints.push(`Định dạng trang hay dùng: ${declared.join(", ")}`);

  const concepts = await proposeImageConcepts(
    {
      draft: ctx.row.draft!,
      brandName: ctx.brand?.name,
      pageFormatHints,
      characterNames: ctx.chars.map((c) => c.name),
      // Chỉ nhân vật KHÔNG có ảnh mẫu mới được tả ngoại hình bằng chữ — có ảnh
      // mẫu mà còn tả bằng chữ thì chữ giành quyền với ảnh, nhân vật vẽ ra sai.
      charactersWithoutReference: ctx.chars
        .filter((c) => !c.referenceImageUrl && c.promptDescription)
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
  /**
   * Ảnh mới có tự thành "ảnh đang chọn" không. Mặc định có (người vẽ là chủ).
   * Người khác vẽ thêm vào bản của chủ thì không — không được đổi ảnh mà chủ
   * sắp đem đăng.
   */
  selectAfter?: boolean;
  /** Người dùng tự tả, bỏ qua phương án AI đề xuất. */
  customPrompt?: string;
  /** Đặc tả người dùng đã sửa tay — vẽ lại đúng theo bản này. */
  spec?: Record<string, any> | null;
  /** Chữ muốn hiện trong ảnh; bỏ trống = không vẽ chữ. */
  textInImage?: string | null;
}): Promise<GenerateRemakeImageResult> {
  const ctx = await loadImageContext(opts.remakeId);
  const { db, row, brand, chars, style } = ctx;
  const aspectRatio = opts.aspectRatio || "1:1";

  const { buildImageSpec, specFromConcept, imageSpecToPrompt, sanitizeSpec } = await import("./image-spec");
  const { collectCharacterRefs } = await import("./character-refs");

  // Chọn phương án TRƯỚC, vì nó quyết định nhân vật nào có trong bài.
  let concept: any = null;
  let conceptIndex: number | null = null;
  if (!opts.customPrompt?.trim()) {
    let concepts = Array.isArray(row.imageConceptsJson) ? (row.imageConceptsJson as any[]) : [];
    if (concepts.length === 0) concepts = await proposeConceptsForRemake(opts.remakeId);
    conceptIndex = Math.min(Math.max(0, opts.conceptIndex ?? 0), concepts.length - 1);
    concept = concepts[conceptIndex];
  }

  // Chỉ đính ảnh mẫu của nhân vật CÓ TRONG BÀI — bài chỉ có Gèn mà đính cả
  // ảnh Gàn thì model hay vẽ thêm Gàn, hoặc pha hai người thành một.
  const usedChars = pickCharactersInUse(chars, concept, opts.customPrompt);

  // Ảnh gốc chỉ làm mẫu bố cục khi CÙNG thể loại: bài gốc là truyện tranh mà
  // phương án là ảnh chat thì bắt chép bố cục truyện tranh vào ảnh chat là vô
  // nghĩa — model sẽ ra một thứ lai.
  const { formatFromImageKind } = await import("../../shared/post-formats");
  const sourceFormat = formatFromImageKind((ctx.decon?.imageReading as any)?.imageKind) || "cartoon";
  const conceptFormat = concept?.format || "cartoon";
  const useSource = sourceFormat === conceptFormat;
  const refs = await collectCharacterRefs(usedChars, { sourceImageUrl: useSource ? ctx.sourceImageUrl : null });

  // Ghi rõ đã đính ảnh nào và thiếu ảnh nào vì sao. Trước đây thiếu ảnh mẫu là
  // im lặng — model vẽ theo chữ, ra nhân vật "na ná", không ai biết tại sao.
  const attachLog = [
    ...refs.characters.map((c) => (c.refIndex ? `${c.name}=#${c.refIndex}` : `${c.name}=THIẾU(${c.missingReason})`)),
    refs.sourceIndex
      ? `ảnh gốc=#${refs.sourceIndex}`
      : !useSource
      ? `ảnh gốc=BỎ (bài gốc là ${sourceFormat}, phương án là ${conceptFormat})`
      : `ảnh gốc=THIẾU(${refs.sourceMissingReason || "bài không có ảnh"})`,
  ].join(", ");
  console.log(`[remake-image] ${opts.remakeId}: đính ${refs.images.length} ảnh — ${attachLog}`);

  const specInput = {
    aspectRatio,
    characters: refs.characters,
    visual: visualOf(brand),
    style,
    sourceIndex: refs.sourceIndex,
  };

  let baseSpec;
  let description: string;
  if (concept) {
    // Phương án có cấu trúc (khung, hành động, biểu cảm, lời thoại).
    description = `${concept.title} — ${concept.why || ""}`.trim();
    baseSpec = specFromConcept(concept, specInput);
  } else {
    // Người dùng tự tả cả cảnh: tôn trọng nguyên văn.
    description = opts.customPrompt!.trim();
    baseSpec = buildImageSpec({ ...specInput, description, textInImage: opts.textInImage });
  }

  // Người dùng sửa tay đặc tả thì dùng bản họ sửa, nhưng vẫn lọc lại.
  const spec = opts.spec ? sanitizeSpec(opts.spec, baseSpec) : baseSpec;
  const prompt = imageSpecToPrompt(spec, refs.images.length);

  // Ảnh đính kèm: ảnh mẫu nhân vật + ảnh gốc của bài.
  const dataUrl = await generateImageGemini(prompt, refs.images.length ? refs.images : undefined, aspectRatio);

  // Ảnh gốc là link ngoài mà tải được thì giữ luôn về kho — link Facebook hết
  // hạn sau vài hôm, lần vẽ sau sẽ không còn ảnh gốc để bám.
  if (refs.sourceIndex && ctx.decon && ctx.sourceImageUrl && !ctx.sourceImageUrl.startsWith("/api/files/")) {
    const { cacheRemoteImage } = await import("./thumb-cache");
    const kept = await cacheRemoteImage(ctx.sourceImageUrl).catch(() => null);
    if (kept) {
      const { deconstructions } = await import("../db/schema");
      await db.update(deconstructions).set({ thumbnailUrl: kept }).where(eq(deconstructions.id, ctx.decon.id)).catch(() => {});
    }
  }
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
    .set({
      imagesJson: images,
      ...(opts.selectAfter === false ? {} : { selectedImageUrl: url }),
      updatedAt: new Date(),
    })
    .where(eq(remakes.id, opts.remakeId));

  return {
    image,
    description,
    spec: spec as any,
    charactersUsed: usedChars.map((c) => {
      const r = refs.characters.find((x) => x.name === c.name);
      return { id: c.id, name: c.name, hasReference: !!r?.refIndex, missingReason: r?.missingReason };
    }),
    sourceAttached: !!refs.sourceIndex,
    sourceMissingReason: refs.sourceIndex ? undefined : refs.sourceMissingReason,
  };
}

/**
 * Nhân vật nào CÓ TRONG BÀI.
 *
 * Theo thứ tự: tên phương án ghi rõ → tên xuất hiện trong lời tả/lời thoại các
 * khung → (không thấy ai) toàn bộ nhân vật của trang. Bước cuối là lưới an
 * toàn: model quên ghi tên thì thà đính đủ còn hơn vẽ ra nhân vật không có mẫu.
 */
export function pickCharactersInUse(
  chars: CharacterRow[],
  concept: {
    characters?: string[];
    panels?: { scene?: string; action?: string; dialogue?: string | null }[];
    messages?: { from?: string; text?: string }[];
  } | null,
  customPrompt?: string,
): CharacterRow[] {
  const byName = new Map(chars.map((c) => [c.name, c]));
  const listed = (concept?.characters || []).map((n) => byName.get(n)).filter(Boolean) as CharacterRow[];
  if (listed.length) return listed;

  const text = [
    customPrompt || "",
    ...(concept?.panels || []).flatMap((p) => [p.scene || "", p.action || "", p.dialogue || ""]),
    // Tin nhắn / bình luận: người gửi là nhân vật thì cần ảnh mẫu cho ảnh đại diện.
    ...((concept as any)?.messages || []).map((m: any) => `${m.from || ""} ${m.text || ""}`),
  ].join(" ");
  const mentioned = chars.filter((c) => text.includes(c.name));
  return mentioned.length ? mentioned : chars;
}
