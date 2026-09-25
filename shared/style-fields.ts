// Bộ trường mô tả PHONG CÁCH VẼ — nguồn duy nhất, dùng chung server + client.
//
// Trước đây phong cách chỉ có 7 trường (medium, linework, shading, color_palette,
// effects, mood, distinctive_traits). Đủ để nói "phong cách này trông thế nào",
// KHÔNG đủ để vẽ lại đúng: hai ảnh cùng "nét mảnh, màu pastel, vui tươi" vẫn ra
// hai thứ khác nhau vì thiếu tỉ lệ nhân vật, cách tô, độ dày nét, màu viền.
//
// Những trường thêm vào đều trả lời một câu hỏi mà người vẽ lại BẮT BUỘC phải
// biết. Trường nào không trả lời câu hỏi nào thì không thêm — bảng mô tả dài ra
// không làm ảnh giống hơn, chỉ làm loãng prompt.
//
// `avoid` là trường quan trọng nhất trong số mới: nói cái KHÔNG thuộc phong cách
// này. Model vẽ hay trôi về mặc định của nó (bóng đổ mềm, nền gradient, mắt to
// kiểu anime) — chỉ có câu phủ định mới giữ được.

export type StyleFieldKind = "text" | "list";

export interface StyleFieldSpec {
  key: string;
  /** Nhãn tiếng Việt cho giao diện. */
  label: string;
  /** Câu hỏi mà trường này trả lời — vừa là gợi ý cho người dùng, vừa là chỉ dẫn cho model. */
  hint: string;
  kind: StyleFieldKind;
  group: string;
  /** Trường then chốt: thiếu là vẽ lại lệch hẳn. Giao diện nhấn mạnh, model ưu tiên. */
  key_field?: boolean;
}

export const STYLE_GROUPS = [
  "Chất liệu & nét",
  "Màu & cách tô",
  "Nhân vật",
  "Bố cục & nền",
  "Tổng thể",
] as const;

export const STYLE_FIELD_SPECS: StyleFieldSpec[] = [
  // --- Chất liệu & nét ---
  {
    key: "medium",
    label: "Chất liệu",
    hint: "Vẽ bằng gì: vector số, cọ số mô phỏng màu nước, chì than, sơn dầu, 3D render…",
    kind: "text",
    group: "Chất liệu & nét",
    key_field: true,
  },
  {
    key: "linework",
    label: "Kiểu nét",
    hint: "Nét sạch dứt khoát, nét rung tay, nét ngắt quãng, hay không có nét viền?",
    kind: "text",
    group: "Chất liệu & nét",
    key_field: true,
  },
  {
    key: "line_weight",
    label: "Độ dày nét",
    hint: "Nét đều một độ dày, hay dày ở ngoài mảnh ở trong? Dày cỡ nào so với khổ ảnh?",
    kind: "text",
    group: "Chất liệu & nét",
  },
  {
    key: "outline_color",
    label: "Màu viền",
    hint: "Viền đen thuần, nâu đậm, hay viền cùng tông đậm hơn phần tô?",
    kind: "text",
    group: "Chất liệu & nét",
  },

  // --- Màu & cách tô ---
  {
    key: "color_palette",
    label: "Bảng màu",
    hint: "Các màu chủ đạo, ghi mã hex nếu biết. Đây là thứ nhận ra phong cách trước cả nét.",
    kind: "list",
    group: "Màu & cách tô",
    key_field: true,
  },
  {
    key: "saturation",
    label: "Độ tươi màu",
    hint: "Màu rực nguyên chất, trầm bạc màu, hay pastel nhạt?",
    kind: "text",
    group: "Màu & cách tô",
  },
  {
    key: "rendering",
    label: "Cách tô",
    hint: "Tô phẳng một lớp, tô khối kiểu cel hai ba mảng, hay chuyển sắc mượt?",
    kind: "text",
    group: "Màu & cách tô",
    key_field: true,
  },
  {
    key: "shading",
    label: "Đổ khối",
    hint: "Bóng cạnh sắc hay bóng mờ? Có bóng đổ xuống nền không?",
    kind: "text",
    group: "Màu & cách tô",
  },
  {
    key: "lighting",
    label: "Ánh sáng",
    hint: "Sáng đều không nguồn rõ, hay có nguồn sáng một phía? Tương phản mạnh hay dịu?",
    kind: "text",
    group: "Màu & cách tô",
  },
  {
    key: "texture",
    label: "Bề mặt",
    hint: "Sạch trơn kiểu vector, có hạt nhiễu, vân giấy, hay vệt cọ thấy rõ?",
    kind: "text",
    group: "Màu & cách tô",
  },

  // --- Nhân vật ---
  {
    key: "character_proportions",
    label: "Tỉ lệ nhân vật",
    hint: "Người cao mấy đầu? Chibi đầu to, tỉ lệ thường, hay kéo dài? Tay chân mập hay thanh?",
    kind: "text",
    group: "Nhân vật",
    key_field: true,
  },
  {
    key: "face_style",
    label: "Cách vẽ mặt",
    hint: "Mắt vẽ thế nào (hai dấu chấm, mắt to có tròng, mắt vạch), mũi miệng có vẽ không?",
    kind: "text",
    group: "Nhân vật",
    key_field: true,
  },
  {
    key: "expression_range",
    label: "Biểu cảm",
    hint: "Cường điệu kiểu hoạt hoạ (mồm há to, mắt chữ X) hay tiết chế tự nhiên?",
    kind: "text",
    group: "Nhân vật",
  },

  // --- Bố cục & nền ---
  {
    key: "composition",
    label: "Bố cục",
    hint: "Nhân vật chiếm bao nhiêu khung, đặt giữa hay lệch? Góc nhìn ngang mắt hay từ trên?",
    kind: "text",
    group: "Bố cục & nền",
  },
  {
    key: "background_treatment",
    label: "Cách xử lý nền",
    hint: "Nền một màu phẳng, nền vẽ chi tiết, hay nền mờ chỉ gợi ý bối cảnh?",
    kind: "text",
    group: "Bố cục & nền",
    key_field: true,
  },
  {
    key: "effects",
    label: "Hiệu ứng",
    hint: "Vạch chuyển động, tia toả, bong bóng thoại, dấu mồ hôi kiểu manga…",
    kind: "text",
    group: "Bố cục & nền",
  },
  {
    key: "typography_in_image",
    label: "Chữ trong ảnh",
    hint: "Nếu phong cách có chữ: kiểu chữ, viết hoa hay thường, có khung nền không?",
    kind: "text",
    group: "Bố cục & nền",
  },

  // --- Tổng thể ---
  {
    key: "mood",
    label: "Không khí",
    hint: "Cảm giác khi nhìn: tếu nhẹ, ấm áp, châm biếm khô, nghiêm túc sạch sẽ…",
    kind: "text",
    group: "Tổng thể",
  },
  {
    key: "distinctive_traits",
    label: "Dấu hiệu nhận ra",
    hint: "Một hai thứ mà nhìn là biết ngay phong cách này, không lẫn với phong cách khác.",
    kind: "text",
    group: "Tổng thể",
    key_field: true,
  },
  {
    key: "avoid",
    label: "KHÔNG thuộc phong cách này",
    hint: "Những thứ model hay tự thêm mà phải chặn: bóng mềm, nền gradient, mắt kiểu anime, ảnh thật…",
    kind: "list",
    group: "Tổng thể",
    key_field: true,
  },
  {
    key: "reference_note",
    label: "Ghi chú",
    hint: "Mọi điều còn lại cần nhớ về phong cách này.",
    kind: "text",
    group: "Tổng thể",
  },
];

export const STYLE_FIELD_KEYS = STYLE_FIELD_SPECS.map((f) => f.key);

const SPEC_BY_KEY = new Map(STYLE_FIELD_SPECS.map((f) => [f.key, f]));

export function styleFieldSpec(key: string): StyleFieldSpec | undefined {
  return SPEC_BY_KEY.get(key);
}

/** Nhãn để hiện lên giao diện. Khoá lạ (do người dùng/model tự thêm) thì hiện nguyên khoá. */
export function styleFieldLabel(key: string): string {
  return SPEC_BY_KEY.get(key)?.label || key;
}

function textValue(raw: unknown): string | null {
  if (typeof raw === "string") return raw.trim() || null;
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  // Model hay trả mảng cho trường chữ — ghép lại thay vì bỏ đi.
  if (Array.isArray(raw)) {
    const parts = raw.map((x) => textValue(x)).filter((x): x is string => !!x);
    return parts.length ? parts.join("; ") : null;
  }
  return null;
}

function listValue(raw: unknown): string[] | null {
  const items: string[] = [];
  if (Array.isArray(raw)) {
    for (const x of raw) {
      const t = textValue(x);
      if (t) items.push(t);
    }
  } else {
    const t = textValue(raw);
    // Chuỗi cho trường danh sách: tách theo dấu phẩy/chấm phẩy/xuống dòng.
    if (t) items.push(...t.split(/[;,\n]/).map((s) => s.trim()).filter(Boolean));
  }
  return items.length ? items : null;
}

/**
 * Chuẩn hoá styleJson về đúng kiểu từng trường.
 *
 * Giữ khoá lạ thay vì bỏ: phong cách cũ có thể có khoá do model tự đặt, và
 * người dùng ghi tay qua MCP cũng được thêm khoá riêng. Bỏ đi là mất dữ liệu
 * mà không ai biết. Chỉ bỏ giá trị RỖNG — trường rỗng trong prompt còn tệ hơn
 * trường không có, vì model coi đó là "phong cách này không có đặc điểm đó".
 */
export function normalizeStyleJson(raw: unknown): Record<string, string | string[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const src = raw as Record<string, unknown>;
  const out: Record<string, string | string[]> = {};

  // Trường trong bộ chuẩn đi trước, theo đúng thứ tự bộ chuẩn — để đọc lên
  // thấy mạch: chất liệu → màu → nhân vật → bố cục → tổng thể.
  for (const spec of STYLE_FIELD_SPECS) {
    if (!(spec.key in src)) continue;
    const v = spec.kind === "list" ? listValue(src[spec.key]) : textValue(src[spec.key]);
    if (v) out[spec.key] = v;
  }

  for (const [k, v] of Object.entries(src)) {
    if (SPEC_BY_KEY.has(k)) continue;
    const t = Array.isArray(v) ? listValue(v) : textValue(v);
    if (t) out[k] = t;
  }

  return out;
}

/** Các trường then chốt còn thiếu — giao diện và MCP đều cần để nhắc bổ sung. */
export function missingKeyStyleFields(styleJson: Record<string, unknown> | null | undefined): StyleFieldSpec[] {
  const has = new Set(Object.keys(normalizeStyleJson(styleJson)));
  return STYLE_FIELD_SPECS.filter((f) => f.key_field && !has.has(f.key));
}

/** Bảng trường kèm câu hỏi — đưa cho model (Claude/Gemini) để nó điền đúng khoá. */
export function styleFieldGuide(): string {
  return STYLE_FIELD_SPECS.map(
    (f) => `- ${f.key} (${f.kind === "list" ? "mảng chuỗi" : "chuỗi"})${f.key_field ? " [then chốt]" : ""}: ${f.hint}`,
  ).join("\n");
}
