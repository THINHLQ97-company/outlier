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
  /** Nét vẽ của trang (Phong cách gắn với thương hiệu). */
  art_style?: { name: string; descriptor: Record<string, any> };
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
  /** Bố cục khung: "1 khung", "4 khung dọc"… */
  layout?: string;
  /**
   * Từng khung: cảnh, hành động, biểu cảm, lời thoại. Có khung thì model vẽ
   * theo khung — chắc hơn nhiều so với một đoạn tả gộp cả câu chuyện.
   */
  panels?: { panel: number; scene: string; action: string; expression: string; dialogue: string | null }[];
  rules: string[];
}

export interface SpecInput {
  description: string;
  aspectRatio: string;
  /**
   * Nhân vật kèm SỐ HIỆU ảnh mẫu (1-based) do chỗ gom ảnh cấp.
   *
   * Không tự suy số theo vị trí trong danh sách: nhân vật không có ảnh vẫn nằm
   * trong danh sách, nên suy theo vị trí là lệch — và trỏ nhầm số thì model bịa
   * ra một nhân vật khác hẳn ảnh mẫu.
   */
  characters: { name: string; promptDescription?: string | null; refIndex: number | null }[];
  visual?: { template?: string; palette?: string[]; mustHave?: string[]; doNots?: string[] } | null;
  /** Chữ muốn hiện trong ảnh (tiêu đề, câu chốt). Bỏ trống = không vẽ chữ. */
  textInImage?: string | null;
  /** Nét vẽ của trang. Không có thì model vẽ theo nét mặc định của nó. */
  style?: { name: string; styleJson: Record<string, any> } | null;
}

export function buildImageSpec(input: SpecInput): ImageSpec {
  const characters = input.characters.map((c) => ({
    name: c.name,
    // Chỉ trỏ tới ảnh mẫu khi thật sự có ảnh, và trỏ đúng số hiệu của nó.
    keep_appearance_from_reference_image: c.refIndex ? `#${c.refIndex}` : undefined,
    note: c.refIndex ? undefined : c.promptDescription || undefined,
  }));

  const rules: string[] = [];

  // Nét vẽ đứng ĐẦU: nó quyết định cả bức ảnh trông ra sao. Cùng cách luồng
  // Sáng tạo — "avoid" và bảng màu tách thành luật riêng, vì phủ định nằm lẫn
  // trong JSON thì model bỏ qua.
  const d = input.style?.styleJson || {};
  if (input.style && Object.keys(d).length) {
    rules.push(
      "Render EXACTLY in the art style described in art_style.descriptor — line weight, rendering method, character proportions, face style and background treatment. This style applies to the whole image and to every character.",
    );
    const avoid = Array.isArray(d.avoid) ? d.avoid : d.avoid ? [String(d.avoid)] : [];
    if (avoid.length) rules.push(`This art style must NOT contain: ${avoid.join("; ")}.`);
  }

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
    art_style:
      input.style && Object.keys(d).length ? { name: input.style.name, descriptor: d } : undefined,
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

/**
 * Dựng đặc tả từ một PHƯƠNG ÁN ẢNH đã đề xuất (image-concepts).
 *
 * Phương án đã có sẵn khung, hành động, biểu cảm, lời thoại — đặc tả chỉ việc
 * ghép thêm nhân vật (kèm số ảnh mẫu), nhận diện thương hiệu và luật.
 */
export function specFromConcept(
  concept: {
    title: string;
    layout: string;
    panels: { scene: string; action: string; expression: string; dialogue: string | null }[];
  },
  input: Omit<SpecInput, "description" | "textInImage">,
): ImageSpec {
  const hasDialogue = concept.panels.some((p) => p.dialogue);
  const base = buildImageSpec({
    ...input,
    description:
      concept.panels.length === 1
        ? concept.panels[0].scene
        : `${concept.layout} comic. ${concept.panels.map((p, i) => `Panel ${i + 1}: ${p.scene}`).join(" ")}`,
    // Lời thoại nằm trong từng khung; ở đây chỉ để bật luật "vẽ chữ đúng dấu".
    textInImage: hasDialogue ? concept.panels.map((p) => p.dialogue).filter(Boolean).join(" / ") : null,
  });

  const rules = [...base.rules];
  if (concept.panels.length > 1) {
    rules.unshift(
      `Draw EXACTLY ${concept.panels.length} panels in this layout: ${concept.layout}. Each panel follows its own scene/action/expression below, in order.`,
    );
  }
  if (hasDialogue) {
    rules.push(
      "Put each panel's dialogue in a speech bubble pointing at the right character. Text in [square brackets] is a narration caption, not a speech bubble.",
    );
  }

  return {
    ...base,
    layout: concept.layout,
    panels: concept.panels.map((p, i) => ({ panel: i + 1, ...p })),
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
    art_style:
      raw.art_style && typeof raw.art_style === "object" && str(raw.art_style.name)
        ? { name: str(raw.art_style.name)!, descriptor: raw.art_style.descriptor || {} }
        : fallback.art_style,
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
    layout: str(raw.layout, fallback.layout),
    panels: Array.isArray(raw.panels)
      ? raw.panels
          .filter((p: any) => p && typeof p === "object" && str(p.scene))
          .map((p: any, i: number) => ({
            panel: i + 1,
            scene: str(p.scene)!,
            action: str(p.action) || "",
            expression: str(p.expression) || "",
            dialogue: str(p.dialogue) || null,
          }))
      : fallback.panels,
    rules: list(raw.rules) || fallback.rules,
  };
}
