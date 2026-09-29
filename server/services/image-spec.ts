// Bản ĐẶC TẢ ẢNH có cấu trúc — thứ thật sự điều khiển việc vẽ.
//
// Học từ marcow-crop: thay vì một đoạn mô tả bằng lời rồi hy vọng model hiểu
// đúng, mô tả được tách thành từng mục rõ ràng (cảnh, nhân vật, nhận diện
// thương hiệu, chữ trong ảnh, luật). Model tuân thủ một danh sách mục chắc hơn
// nhiều so với một đoạn văn xuôi, và quan trọng hơn: NGƯỜI DÙNG SỬA ĐƯỢC ĐÚNG
// MỤC CẦN SỬA.
//
// Khác marcow một điểm cố ý: ở đó JSON là thứ người dùng nhìn thấy. Ở đây JSON
// là thứ bên trong; giao diện hiện từng mục bằng tiếng Việt, ai muốn động vào
// JSON thô thì mở ra xem — không bắt người làm nội dung đọc dấu ngoặc nhọn.
export interface ImageSpec {
  role: "brand_post_illustration";
  aspect_ratio: string;
  /** Cảnh cần vẽ, viết bằng tiếng Anh vì đi thẳng vào model vẽ. */
  scene: string;
  characters: { name: string; keep_appearance_from_reference_image?: string; note?: string }[];
  brand_visual: {
    template?: string;
    palette?: string[];
    must_have?: string[];
    do_not?: string[];
  };
  /** Chữ hiện trong ảnh — rỗng nghĩa là không vẽ chữ. */
  text_in_image: string | null;
  rules: string[];
}

export interface SpecInput {
  description: string;
  aspectRatio: string;
  characters: { name: string; promptDescription?: string | null; hasReference: boolean }[];
  visual?: { template?: string; palette?: string[]; mustHave?: string[]; doNots?: string[] } | null;
  /** Chữ muốn hiện trong ảnh (tiêu đề, câu chốt). Bỏ trống = không vẽ chữ. */
  textInImage?: string | null;
}

export function buildImageSpec(input: SpecInput): ImageSpec {
  const characters = input.characters.map((c, i) => ({
    name: c.name,
    // Chỉ trỏ tới ảnh mẫu khi thật sự có ảnh: trỏ vào ảnh không tồn tại thì
    // model tự bịa ra một nhân vật khác.
    keep_appearance_from_reference_image: c.hasReference ? `#${i + 1}` : undefined,
    note: c.hasReference ? undefined : c.promptDescription || undefined,
  }));

  const rules: string[] = [];
  if (characters.some((c) => c.keep_appearance_from_reference_image)) {
    rules.push(
      "Keep each character's face, hairstyle, costume and colors IDENTICAL to their reference image. Do not redesign them.",
    );
  }
  if (input.visual?.doNots?.length) {
    // Điều cấm đặt ở CUỐI: phần cuối được model tuân thủ chắc hơn.
    rules.push(`Must NOT contain: ${input.visual.doNots.join("; ")}.`);
  }
  if (input.visual?.palette?.length) {
    rules.push(`Stay within this palette: ${input.visual.palette.join(", ")}.`);
  }
  rules.push(
    input.textInImage?.trim()
      ? "Render the given text_in_image in Vietnamese with CORRECT diacritics. No other text."
      : "Do NOT render any text in the image.",
  );

  return {
    role: "brand_post_illustration",
    aspect_ratio: input.aspectRatio,
    scene: input.description,
    characters,
    brand_visual: {
      template: input.visual?.template,
      palette: input.visual?.palette,
      must_have: input.visual?.mustHave,
      do_not: input.visual?.doNots,
    },
    text_in_image: input.textInImage?.trim() || null,
    rules,
  };
}

/** Đổi đặc tả thành prompt gửi model vẽ. */
export function imageSpecToPrompt(spec: ImageSpec, refCount: number): string {
  const head =
    refCount > 0
      ? `You are an illustration engine for a brand's social post. Attached reference images are numbered #1..#${refCount} in order. Follow this JSON spec exactly:`
      : "You are an illustration engine for a brand's social post. Follow this JSON spec exactly:";
  return `${head}\n\n${JSON.stringify(spec, null, 2)}`;
}

/**
 * Nhận đặc tả người dùng sửa tay, trả về bản sạch.
 *
 * Không tin dữ liệu gửi lên: người dùng có thể xoá mất trường, đổi kiểu, hoặc
 * dán nhầm JSON khác. Thiếu cảnh thì từ chối — vẽ mà không có cảnh thì vẽ gì.
 */
export function sanitizeSpec(raw: any, fallback: ImageSpec): ImageSpec {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fallback;

  const str = (v: any, alt?: string) => (typeof v === "string" && v.trim() ? v.trim() : alt);
  const list = (v: any) => {
    if (!Array.isArray(v)) return undefined;
    const items = v.map((x) => String(x).trim()).filter(Boolean);
    // Mảng rỗng bỏ hẳn: "do_not": [] trong prompt trông như một yêu cầu, model
    // đọc xong không biết phải làm gì với nó.
    return items.length ? items : undefined;
  };

  const scene = str(raw.scene);
  if (!scene) throw new Error("Đặc tả thiếu phần 'Cảnh cần vẽ' — không có cảnh thì không vẽ được gì.");

  return {
    role: "brand_post_illustration",
    aspect_ratio: str(raw.aspect_ratio, fallback.aspect_ratio)!,
    scene,
    characters: Array.isArray(raw.characters)
      ? raw.characters
          .filter((c: any) => c && typeof c === "object" && str(c.name))
          .map((c: any) => ({
            name: str(c.name)!,
            keep_appearance_from_reference_image: str(c.keep_appearance_from_reference_image),
            note: str(c.note),
          }))
      : fallback.characters,
    brand_visual: {
      template: str(raw.brand_visual?.template),
      palette: list(raw.brand_visual?.palette),
      must_have: list(raw.brand_visual?.must_have),
      do_not: list(raw.brand_visual?.do_not),
    },
    text_in_image: str(raw.text_in_image) || null,
    rules: list(raw.rules) || fallback.rules,
  };
}
