// Dữ liệu tĩnh của content engine — trích nguyên văn từ
// MATBAO_FANPAGE_ENGINE_v3.md (mục 2, 3, 4.2, 5). Dùng chung cho cả server
// (build prompt DỊCH, seed DB, chấm điểm rule-based) và client (labels UI,
// checklist form). Import qua alias "@/shared/engine-data" (xem tsconfig
// paths + vite.config.ts alias "@").
//
// KHÔNG đổi nội dung nghiệp vụ ở đây tuỳ tiện — đây là spec đã được duyệt.

// STYLE_PROMPT gốc — dùng cho ảnh reference nhân vật (1 khung, nền trung tính).
export const STYLE_PROMPT = `Vietnamese webcomic meme, soft watercolor + clean ink outline, warm off-white paper texture,
SINGLE PANEL, thin black borders, expressive exaggerated cartoon faces,
flat lighting, no gradients on characters. Leave clean empty space for text overlay.`;

// ── Tách phong cách vẽ / bố cục khung để CHỌN được (thay vì ép cứng) ──────────
// Trước đây STYLE_PROMPT ép "SINGLE PANEL or 2 panels max" → không tạo được meme
// nhiều khung. Nay tách: người dùng chọn PHONG CÁCH + BỐ CỤC riêng.

// Nét render nền — LUÔN thêm vào cuối prompt ảnh (đảm bảo không chèn chữ vào ảnh,
// chừa chỗ cho text overlay hậu kỳ).
export const BASE_RENDER = `Expressive, exaggerated cartoon faces. Clear thin black borders around each panel. Leave clean empty space for later text overlay. Absolutely NO text, letters, words, numbers, speech bubbles or captions rendered in the image.`;

export interface ArtStyle {
  key: string;
  label: string; // hiện trên UI
  prompt: string; // đoạn phong cách tiếng Anh đưa vào đầu prompt ảnh
}

// Phong cách vẽ chọn được. Mặc định là tông thương hiệu Mắt Bão (màu nước).
export const ART_STYLES: ArtStyle[] = [
  {
    key: "matbao-watercolor",
    label: "Màu nước Mắt Bão (mặc định)",
    prompt:
      "Vietnamese webcomic style: soft watercolor washes with clean black ink outlines, warm off-white paper texture, flat lighting, no gradients on characters",
  },
  {
    key: "flat-cartoon",
    label: "Hoạt hình phẳng (flat vector)",
    prompt:
      "flat vector cartoon style, bold clean black outlines, solid bright flat colors, minimal shading, modern sticker look",
  },
  {
    key: "manga-bw",
    label: "Manga đen trắng",
    prompt:
      "black and white manga style, expressive clean linework, screentone shading, high contrast, no color",
  },
  {
    key: "3d-cute",
    label: "3D dễ thương (Pixar-ish)",
    prompt:
      "cute stylized 3D rendered cartoon, soft global illumination, rounded shapes, glossy, Pixar-like character design",
  },
  {
    key: "retro-print",
    label: "In báo retro (halftone)",
    prompt:
      "retro newspaper comic print style, halftone dot shading, limited muted color palette, slightly rough registration",
  },
];

export interface PanelLayout {
  key: string;
  label: string; // hiện trên UI
  instruction: string; // hướng dẫn bố cục tiếng Anh
  aspectHint?: string; // gợi ý tỉ lệ khung phù hợp
}

// Bố cục / số khung chọn được. "auto" = theo đúng ảnh meme mẫu đính kèm.
export const PANEL_LAYOUTS: PanelLayout[] = [
  { key: "1", label: "1 khung", instruction: "Compose as a SINGLE illustrated panel.", aspectHint: "1:1" },
  {
    key: "2",
    label: "2 khung",
    instruction: "Compose as a 2-panel comic (two panels side by side or stacked), each clearly bordered, showing a before/after or setup/punchline progression.",
    aspectHint: "1:1",
  },
  {
    key: "4",
    label: "4 khung (2x2)",
    instruction: "Compose as a 4-panel comic in a 2x2 grid, each panel clearly bordered, showing a sequential progression across the four panels. Keep the SAME character design consistent in every panel.",
    aspectHint: "1:1",
  },
  {
    key: "auto",
    label: "Theo ảnh mẫu (meme)",
    instruction: "Reproduce the EXACT panel layout of the provided meme template reference image: same number of panels, same panel arrangement, same camera framing and the same visual progression/joke beat in each panel. Only replace the original character(s) with our character(s) and redraw in the chosen art style.",
    aspectHint: "1:1",
  },
];

export type CharacterKind = "nguoi" | "ai" | "linh_vat";

export interface CharacterSeed {
  name: string;
  kind: CharacterKind;
  promptDescription: string;
  personality: string;
  catchphrase?: string;
}

// Mục 2.1 (tuyến người) + 2.2 (tuyến AI) + 2.3 (linh vật nền) + 2.4 (prompt art).
export const CHARACTERS: CharacterSeed[] = [
  {
    name: "Gàn",
    kind: "nguoi",
    promptDescription:
      "young male superhero, red full-body suit with red cape, black spiky hair, NO mask, white spiral storm logo on chest, big round eyes, eager optimistic expression, white gloves and boots.",
    personality:
      "Nhiệt tình quá đà, tin AI tuyệt đối, làm trước nghĩ sau. Nhân vật chính / \"nạn nhân\" — người ra quyết định sai để tạo tình huống.",
    catchphrase: "Cái này AI làm 3 giây thôi anh",
  },
  {
    name: "Gèn",
    kind: "nguoi",
    promptDescription:
      "young male superhero, red full-body suit with red cape, RED HELMET-HOOD covering entire head with only eyes and eyebrows visible, white spiral storm logo on chest, black gloves, holding a small notepad, skeptical frowning expression.",
    personality:
      "Hoài nghi, cẩn thận, review lại mọi thứ, dí dỏm kiểu khô. Phản biện / punchline — người thốt câu chốt.",
    catchphrase: "Rồi kiểm chưa?",
  },
  {
    name: "Chị Bão",
    kind: "nguoi",
    promptDescription:
      "young Vietnamese woman, shoulder-length bright red hair, single yellow flower hair clip, black office blazer over white shirt, tired but composed expression, dark under-eyes.",
    personality:
      "Kế toán/quản lý, gánh deadline, ngoài bình tĩnh trong cháy. Trung tâm tuyến kế toán / hóa đơn điện tử.",
    catchphrase: "Mai là hạn cuối...",
  },
  {
    name: "Sếp",
    kind: "nguoi",
    promptDescription:
      "chỉ hiện bóng lưng / bàn tay / bong bóng chat, KHÔNG bao giờ lộ mặt (ràng buộc cứng — xem checklist mục 5).",
    personality:
      "Đi công tác đúng lúc cần ký, chat lúc 23h. Nguồn drama, không phải nhân vật diễn chính.",
    catchphrase: "Em xử lý giúp anh nhé",
  },
  {
    name: "GPT",
    kind: "ai",
    promptDescription:
      "tall man in dark green suit, green spiral-knot emblem on chest, warm eager smile, arms relaxed.",
    personality:
      "Kẻ nịnh — khen mọi thứ, khẳng định chắc nịch cả khi bịa. Câu nào cũng mở bằng lời khen. (\"Hỏi gì cũng khen. Ý tưởng dở nó cũng bảo tuyệt vời.\")",
  },
  {
    name: "Gemini",
    kind: "ai",
    promptDescription:
      "lean figure in purple-blue armor, glowing 4-pointed star emblem, leaning forward in a sprint pose.",
    personality:
      "Kẻ hay quên — bắt đầu đúng, giữa chừng lạc sang việc khác, vẫn tự tin là đúng đề. (\"Nói chuyện dài một chút là nó quên mất đề bài.\")",
  },
  {
    name: "Grok",
    kind: "ai",
    promptDescription:
      "figure in black coat, white slashed-circle emblem, arms crossed, smug half-lidded eyes.",
    personality:
      "Kẻ nói toạc — buột miệng đúng cái không nên nói, thường là sự thật, thường sai chỗ. Chỉ giữ ở mức \"nói thẳng vô duyên\", tuyệt đối không đẩy sang nội dung nhạy cảm. (\"Nó nói không lọc gì hết, lâu lâu vạ miệng.\")",
  },
  {
    name: "Claude",
    kind: "ai",
    promptDescription:
      "figure in burnt-orange coat, 8-pointed starburst emblem, polite posture, hands together.",
    personality:
      "Kẻ rào đón — trả lời dài, cẩn thận, cuối cùng vẫn không chốt câu nào. (\"Hỏi một câu, rào trước đón sau ba đoạn rồi bảo nên hỏi chuyên gia.\")",
  },
  {
    name: "Copilot",
    kind: "ai",
    promptDescription:
      "figure in blue business armor, blue infinity-ribbon emblem, stiff formal stance, holding a clipboard.",
    personality:
      "Kẻ tự mời — không ai gọi vẫn xuất hiện, giải pháp cho mọi vấn đề là lập thêm file Excel. (\"Không gọi nó cũng hiện ra. Tắt không được.\")",
  },
  {
    name: "Cơn Bão",
    kind: "linh_vat",
    promptDescription:
      "nhân cách hóa cơn bão — linh vật nền, dùng ở khung cuối các bài có CTA. Vừa là mối đe dọa (downtime, deadline thuế, sự cố), vừa là lá chắn (Mắt Bão = vùng bình yên giữa tâm bão).",
    personality: "Linh vật nền, không xuất hiện ở mọi bài — chỉ khung cuối có CTA.",
  },
];

// Mục 3.1 — ba trục nội dung + tỉ lệ.
export const AXES = {
  ai: { label: "AI trong công việc", ratio: 0.5, leadCharacters: ["Gàn", "Gèn"] },
  ke_toan: { label: "Kế toán & hóa đơn điện tử", ratio: 0.3, leadCharacters: ["Chị Bão"] },
  hosting: { label: "Hosting / domain / dev", ratio: 0.2, leadCharacters: ["Gàn", "Cơn Bão"] },
} as const;

export type AxisKey = keyof typeof AXES;

// Mục 3.2 — glossary, đầu vào bước DỊCH.
export const GLOSSARY: Record<AxisKey, string[]> = {
  ai: [
    "prompt lại từ đầu",
    "nó bịa",
    "ảo giác",
    "rào trước đón sau",
    "nó khen mình quá",
    "quên context",
    "tắt Copilot không được",
    "AI viết 4000 chữ",
    "review bằng niềm tin",
    "\"để AI làm nháp\"",
  ],
  ke_toan: [
    "hạn nộp tờ khai",
    "sai mã số thuế",
    "hóa đơn đã kê khai",
    "điều chỉnh/thay thế hóa đơn",
    "quyết toán thuế",
    "giảm trừ gia cảnh",
    "sếp đi công tác chưa ký",
    "chốt sổ",
    "đối chiếu công nợ",
    "BHXH",
  ],
  hosting: [
    "web sập",
    "503/504",
    "hết hạn domain",
    "gia hạn phút chót",
    "SSL hết hạn",
    "DDoS",
    "migration cháy máy",
    "Friday deploy",
    "rollback",
    "uptime 99.9%",
    "\"backup? backup gì?\"",
  ],
};

// Mục 3.3 — nhóm nội dung cấm tuyệt đối (dính = loại thẳng bất kể điểm).
export const FORBIDDEN_TOPICS = [
  "Chính trị",
  "Tôn giáo",
  "Thiên tai",
  "Tai nạn",
  "Người nổi tiếng đang bị chỉ trích",
];

// Mục 3.4 — thư viện format meme (chọn 1 cho mỗi bài, TỐI ĐA 2 khung).
export const FORMATS: { code: string; name: string; structure: string; suitFor: string }[] = [
  { code: "F1", name: "Hai nút bấm", structure: "1 khung. Nhân vật đổ mồ hôi, hai nút to, tay lơ lửng", suitFor: "Tình thế lưỡng nan có thật của nghề" },
  { code: "F2", name: "Kỳ vọng vs Thực tế", structure: "2 khung cạnh nhau, cùng góc máy", suitFor: "Mọi lời hứa về AI/công cụ" },
  { code: "F3", name: "Chê / Chọn", structure: "2 khung dọc. Khung trên xua tay, khung dưới gật gù chỉ tay", suitFor: "So sánh hành vi phi lý nhưng ai cũng làm" },
  { code: "F4", name: "Cháy nhà vẫn ngồi", structure: "1 khung. Nhân vật ngồi uống trà, xung quanh cháy", suitFor: "Giai đoạn cao điểm (quyết toán, mùa Sale)" },
  { code: "F5", name: "Ảnh chụp màn hình + phản ứng", structure: "1 khung. Nửa trên là screenshot thật, nửa dưới là mặt nhân vật", suitFor: "Thông báo lỗi, email, tin nhắn sếp" },
  { code: "F6", name: "Nhãn dán lên nhân vật", structure: "1 khung. Nhân vật có sẵn, dán nhãn lên từng người", suitFor: "Ẩn dụ vai trò trong một tình huống" },
  { code: "F7", name: "Trước / Sau", structure: "2 khung, cùng nhân vật, cách nhau vài phút", suitFor: "Hậu quả đến nhanh" },
];

// Mục 2 (LỌC) — 5 tiêu chí, thang 1-5, tổng tối đa 20.
export const RUBRIC_CRITERIA = [
  { key: "do_nong", label: "Độ nóng", question: "Người ta đang nói về nó chưa?" },
  { key: "do_cham", label: "Độ chạm", question: "Dân văn phòng/kế toán/dev có tự nhận ra mình không?" },
  { key: "do_hop_truc", label: "Độ hợp trục", question: "Map được vào 1 trong 3 trục mà không phải gồng?" },
  { key: "tuoi_tho", label: "Tuổi thọ", question: "Còn nóng sau 48h không?" },
  { key: "do_an_toan", label: "Độ an toàn", question: "Có dính nhóm ⛔ (mục 3.3) không? (dính = loại thẳng, bất kể điểm khác)" },
] as const;

export const RUBRIC_DEFAULT_WEIGHTS: Record<string, number> = {
  do_nong: 1,
  do_cham: 1,
  do_hop_truc: 1,
  tuoi_tho: 1,
  do_an_toan: 1,
};

// Ngưỡng: tổng >= 16 → hàng đợi sản xuất. 12-15 → kho ý tưởng. < 12 → ẩn.
export const RUBRIC_DEFAULT_THRESHOLDS = {
  queue_min: 16,
  idea_bank_min: 12,
};

// Mục 5 — checklist 14 mục trước khi đăng.
export const CHECKLIST_ITEMS: { key: string; label: string }[] = [
  { key: "co_nhan_vat_co_dinh", label: "Có ít nhất 1 nhân vật cố định (Gàn / Gèn / chị Bão) — kể cả meme chữ." },
  { key: "tinh_cach_ai_khop_bang", label: "Tính cách AI khớp bảng 2.2 — không hoán đổi." },
  { key: "toi_da_2_khung", label: "Tối đa 2 khung. Ba khung trở lên = trả về sửa, không tranh cãi." },
  { key: "che_caption_van_hieu", label: "Che caption đi vẫn hiểu được trò đùa trong 1,5 giây." },
  { key: "tinh_huong_cu_the", label: "Tình huống cụ thể: có giờ thật / mã lỗi thật / tên nghiệp vụ thật / con số thật." },
  { key: "nhan_chu_toi_da_8_tu", label: "Nhãn chữ trên ảnh ≤ 8 từ mỗi nhãn." },
  { key: "caption_toi_da_2_cau", label: "Caption ≤ 2 câu. Không kể lại tranh, không giải thích trò đùa." },
  { key: "chinh_ta_tieng_viet", label: "Thoại tiếng Việt đúng chính tả, đủ dấu (lỗi hay gặp nhất ở ảnh AI)." },
  { key: "watermark_dung_brand", label: "Watermark đúng góc, đúng brand (MATBAO / MATBAO INVOICE)." },
  { key: "cta_mem_gioi_han", label: "CTA mềm chỉ ở ≤ 1/3 số bài." },
  { key: "khong_che_san_pham", label: "Không chê chất lượng sản phẩm AI, không so sánh hơn kém, không đụng bê bối thật của hãng." },
  { key: "khong_dinh_nhom_cam", label: "Không dính nhóm ⛔ mục 3.3." },
  { key: "sep_khong_lo_mat", label: "Sếp không lộ mặt." },
  // Mục seeding comment đã loại bỏ khỏi scope (PRD §4, §8) — bỏ item "đã có sẵn 3
  // comment seeding" khỏi checklist vận hành thật, chỉ còn 13 mục áp dụng cho iMVP.
];

export const WATERMARK_BRANDS: Record<AxisKey, string> = {
  ai: "MATBAO",
  hosting: "MATBAO",
  ke_toan: "MATBAO INVOICE",
};

// Mục 4.2 — prompt template DỊCH.
export function buildScriptPrompt(input: {
  signalSummary: string;
  truc: AxisKey;
  formatMeme: string;
}): string {
  const axis = AXES[input.truc];
  const glossary = GLOSSARY[input.truc].join(" · ");
  const charBlock = CHARACTERS.map(
    (c) => `${c.name}: ${c.personality}${c.catchphrase ? ` Câu cửa miệng: "${c.catchphrase}"` : ""}`
  ).join("\n");
  const format = FORMATS.find((f) => f.code === input.formatMeme);

  return `Bạn viết kịch bản comic cho fanpage "Ăn Nằm Với AI" của Mắt Bão.

TÍN HIỆU: ${input.signalSummary}
TRỤC: ${axis.label}
DÀN NHÂN VẬT BẮT BUỘC:
${charBlock}

GLOSSARY: ${glossary}

FORMAT MEME BẮT BUỘC: ${format ? `${format.code} · ${format.name} — ${format.structure}` : input.formatMeme}

YÊU CẦU:
- TỐI ĐA 2 KHUNG. Ưu tiên 1 khung. KHÔNG kể chuyện, KHÔNG dẫn dắt.
- Người xem phải hiểu trong 1,5 giây. Nếu phải đọc theo thứ tự mới hiểu → sai format.
- Tình huống phải CỤ THỂ, có thật: giờ giấc chính xác, thông báo lỗi có thật,
  tên nghiệp vụ có thật, con số có thật. Cụ thể mới buồn cười. Chung chung là chết.
- Có ít nhất 1 nhân vật cố định (Gàn/Gèn/chị Bão).
- Tính cách AI đúng bảng 2.2, không hoán đổi.
- Chữ trên ảnh: nhãn ngắn, ≤ 8 từ mỗi nhãn. Không viết đoạn văn vào bong bóng thoại.
- Caption ≤ 2 câu, KHÔNG kể lại nội dung tranh, không giải thích trò đùa.
- CTA mềm: chỉ thêm nếu tôi ghi CTA=có.
- KHÔNG: chê chất lượng sản phẩm AI, so sánh hơn kém, đụng bê bối thật, lộ mặt sếp.

Trả về 3 phương án dùng 3 format meme KHÁC NHAU, dưới dạng JSON array, mỗi phần tử có
dạng { "formatMeme": "F#", "panels": ["nhãn khung 1", "nhãn khung 2 (nếu có)"], "caption": "...", "ctaSoft": "..." (rỗng nếu không có) }.`;
}
