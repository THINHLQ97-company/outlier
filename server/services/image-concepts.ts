// Đề xuất PHƯƠNG ÁN ẢNH cho một bản remake — có cấu trúc, không phải văn xuôi.
//
// Thay cho bước "nhờ model tả một tấm ảnh bằng một đoạn văn". Đoạn văn đó là
// chỗ yếu nhất của cả luồng: nó trộn cảnh, hành động, ngoại hình, chữ trong ảnh
// vào một khối, rồi model vẽ phải tự đoán đâu là lệnh chính.
//
// Ba bài học lấy từ marcow-crop (đang chạy ổn ở production):
//
// 1. KHÔNG tả ngoại hình nhân vật bằng chữ khi nhân vật có ảnh mẫu. Chữ "ông
//    già đội mũ" sẽ GIÀNH QUYỀN với ảnh mẫu là một chú ngựa, và model nghe theo
//    chữ. Ngoại hình chỉ đến từ ảnh mẫu; chữ chỉ tả trạng thái, biểu cảm, hành
//    động. Đây là lý do Gèn vẽ ra không giống ảnh mẫu.
// 2. Chia theo KHUNG, mỗi khung có cảnh / hành động / biểu cảm / lời thoại riêng.
//    Bài gốc truyện tranh 4 khung thì phương án cũng 4 khung.
// 3. Mỗi nhân vật một tư thế tay mỗi khung — tả "vừa ôm đầu vừa gõ phím" là
//    model vẽ ra bốn cánh tay.
//
// Ra BA phương án thật sự khác nhau, để có cái chọn mà không phải bấm vẽ lại
// rồi cầu may.
import { generateTextGemini } from "./gemini-direct";
import { POST_FORMATS, isPostFormatId, formatFromImageKind, type PostFormatId } from "../../shared/post-formats";

export interface ConceptPanel {
  /** Bối cảnh khung này — tiếng Anh, đi thẳng vào model vẽ. */
  scene: string;
  /** Hành động/tư thế của từng nhân vật — tiếng Anh, KHÔNG tả ngoại hình. */
  action: string;
  /** Biểu cảm khuôn mặt — tiếng Anh. */
  expression: string;
  /** Lời thoại/dẫn chuyện hiện trên ảnh, tiếng Việt có dấu. null = không chữ. */
  dialogue: string | null;
}

/** Một tin nhắn / bình luận — chữ tiếng Việt nguyên văn sẽ hiện trên ảnh. */
export interface ConceptMessage {
  from: string;
  text: string;
}

/** Đánh giá kiểu Google Business. */
export interface ConceptReview {
  /** CHỈ tên hư cấu hoặc tên thương hiệu của chính mình — không tên doanh nghiệp thật khác. */
  business: string;
  rating: number;
  reviewer: string;
  text: string;
  reply?: string | null;
}

export interface ImageConcept {
  /** Thể loại tổng quan (shared/post-formats.ts). */
  format: PostFormatId;
  /** Tên ngắn tiếng Việt để người dùng phân biệt ba phương án. */
  title: string;
  /** Vì sao phương án này hợp bài — tiếng Việt, dẫn chiếu nội dung bản viết. */
  why: string;
  /** Bố cục: "1 khung", "2 khung ngang", "4 khung dọc"… */
  layout: string;
  /** Cartoon: các khung. Thể loại khác: có thể rỗng. */
  panels: ConceptPanel[];
  /** Tin nhắn / bình luận (thể loại chat, social). */
  messages?: ConceptMessage[];
  /** Tên cuộc trò chuyện hoặc chú thích bài đăng (chat, social, text_card). */
  caption?: string | null;
  /** Đánh giá (thể loại review). */
  review?: ConceptReview | null;
  /** Tên nhân vật có mặt — chỉ dùng tên được cấp, không tự đặt. */
  characters: string[];
}

export interface ConceptSource {
  imageReading?: { textInImage?: string; imageKind?: string; technique?: string; description?: string } | null;
  formula?: string | null;
  direction?: string | null;
}

export interface ConceptInput {
  draft: string;
  /** Tên thương hiệu — tên duy nhất được phép dùng cho doanh nghiệp THẬT trong đánh giá. */
  brandName?: string;
  /**
   * Trang hay đăng thể loại gì: khuôn ảnh quen, định dạng trang khai. Thể loại
   * hợp trang được xếp đầu — trang sống bằng ảnh chat thì phương án chat lên trước.
   */
  pageFormatHints?: string[];
  /** Tên nhân vật được phép dùng. Ngoại hình KHÔNG đưa vào — xem bài học 1. */
  characterNames: string[];
  /** Nhân vật KHÔNG có ảnh mẫu: chỉ những nhân vật này mới được tả ngoại hình. */
  charactersWithoutReference?: { name: string; appearance: string }[];
  visual?: { template?: string; palette?: string[]; mustHave?: string[]; doNots?: string[] } | null;
  source?: ConceptSource;
}

export function buildConceptPrompt(input: ConceptInput, count: number): string {
  const r = input.source?.imageReading;
  const sourceLines: string[] = [];
  if (r?.imageKind) sourceLines.push(`- Loại ảnh: ${r.imageKind}`);
  if (r?.technique) sourceLines.push(`- Gây chú ý bằng: ${r.technique}`);
  if (r?.description) sourceLines.push(`- Ảnh gốc trông thế nào: ${r.description}`);
  if (r?.textInImage) sourceLines.push(`- Chữ trong ảnh gốc: "${r.textInImage.slice(0, 400)}"`);
  if (input.source?.formula) sourceLines.push(`- Cách triển khai: ${input.source.formula}`);

  const v = input.visual;
  const visualLines: string[] = [];
  if (v?.template) visualLines.push(`- Khuôn ảnh quen của trang: ${v.template}`);
  if (v?.mustHave?.length) visualLines.push(`- Luôn phải có: ${v.mustHave.join("; ")}`);
  if (v?.doNots?.length) visualLines.push(`- KHÔNG BAO GIỜ xuất hiện: ${v.doNots.join("; ")}`);

  const names = input.characterNames;
  const noRef = input.charactersWithoutReference || [];

  return `Bạn là đạo diễn hình ảnh cho fanpage. Đề xuất ${count} PHƯƠNG ÁN ẢNH cho bản viết dưới đây.

=== BẢN VIẾT CẦN MINH HOẠ ===
${input.draft.slice(0, 2500)}

${sourceLines.length ? `=== BÀI GỐC ĐANG HỌC THEO (bám HÌNH THỨC, KHÔNG chép nội dung) ===\n${sourceLines.join("\n")}\n` : ""}
${input.source?.direction?.trim() ? `=== HƯỚNG NỘI DUNG CHỦ TRANG ĐẶT (thắng mọi gợi ý khác) ===\n${input.source.direction.trim()}\n` : ""}
${visualLines.length ? `=== NHẬN DIỆN HÌNH ẢNH CỦA TRANG ===\n${visualLines.join("\n")}\n` : ""}
${formatBlock(input)}
=== QUY TẮC BẮT BUỘC ===
1. Ảnh minh hoạ ĐÚNG nội dung bản viết — đọc ảnh xong phải hiểu được ý bài, không phải một cảnh chung chung cùng chủ đề.
2. Bài gốc là truyện tranh/ảnh nhiều khung thì GIỮ ĐÚNG số khung và cách chia khung; nội dung từng khung lấy từ bản viết.
3. ${count} phương án phải KHÁC NHAU THẬT về cách thể hiện (khoảnh khắc khác, bố cục khác, cách gây cười khác) — không phải một ý viết lại ba lần.
4. Nội dung hợp nhiều thể loại thì ${count} phương án TRẢI RA ít nhất 2 thể loại khác nhau. Phương án ĐẦU TIÊN là thể loại hợp TRANG NÀY nhất (xem tín hiệu ở trên).
5. Chữ hiện trên ảnh phải NGẮN — công cụ vẽ hay viết sai dấu khi chữ dài. Tin nhắn/bình luận: tối đa 6 dòng, mỗi dòng dưới 80 ký tự. Đánh giá: dưới 280 ký tự.
6. ĐÁNH GIÁ: tên doanh nghiệp CHỈ được là tên HƯ CẤU (bịa cho vui, nghe rõ là bịa)${input.brandName ? ` hoặc chính thương hiệu "${input.brandName}"` : ""}. TUYỆT ĐỐI không dùng tên doanh nghiệp, thương hiệu hay người thật khác — ảnh đánh giá giả gắn tên công ty thật là bôi nhọ.

=== QUY TẮC NHÂN VẬT (TỐI QUAN TRỌNG) ===
- Chỉ được dùng đúng các tên sau: ${names.length ? names.map((n) => `"${n}"`).join(", ") : "(trang không có nhân vật cố định — dùng người/vật chung chung)"}.
- TUYỆT ĐỐI KHÔNG tả ngoại hình, giống loài, trang phục, màu lông/tóc của nhân vật trong BẤT KỲ trường nào. Ngoại hình đã có ảnh mẫu lo — chữ tả ngoại hình sẽ giành quyền với ảnh mẫu và làm nhân vật vẽ ra sai.
  Sai: "Gèn, a large horse in a suit, is pointing". Đúng: "Gèn is pointing at the screen, chest puffed out".
- Chỉ tả TRẠNG THÁI, BIỂU CẢM, HÀNH ĐỘNG của nhân vật.
- Mỗi nhân vật MỘT tư thế tay mỗi khung. Không viết "vừa ôm đầu vừa gõ phím" — model sẽ vẽ ra bốn cánh tay.
${noRef.length ? `- Riêng các nhân vật CHƯA có ảnh mẫu sau thì ĐƯỢC tả ngoại hình (không có ảnh nên phải tả): ${noRef.map((c) => `${c.name}: ${c.appearance}`).join(" | ")}` : ""}

=== NGÔN NGỮ ===
- scene, action, expression: TIẾNG ANH (đi thẳng vào model vẽ).
- title, why, dialogue: TIẾNG VIỆT có dấu đầy đủ.
- dialogue là chữ hiện trên ảnh. Dẫn chuyện thì bọc [NGOẶC VUÔNG] ở đầu. Khung không cần chữ thì để null.

Trả về DUY NHẤT JSON. Mỗi phương án có "format" là một trong: ${POST_FORMATS.map((f) => f.id).join(", ")}.
- cartoon: điền "panels".
- chat / social: điền "messages" (from = tên người nói, text = nguyên văn tiếng Việt) và "caption" (tên cuộc trò chuyện / chú thích bài đăng).
- review: điền "review" (business, rating 1-5, reviewer, text, reply nếu có).
- text_card: điền "caption" là chữ chính.
{"concepts":[{"format":"cartoon","title":"tên ngắn","why":"vì sao hợp bài","layout":"1 khung","characters":["tên"],"panels":[{"scene":"...","action":"...","expression":"...","dialogue":"... hoặc null"}]},{"format":"chat","title":"...","why":"...","layout":"chat 2 người","characters":["tên"],"caption":"tên cuộc trò chuyện","messages":[{"from":"tên","text":"..."}]}]}`;
}

/**
 * Khối thể loại trong prompt: danh sách 5 nhóm + tín hiệu trang hay đăng gì.
 *
 * Tín hiệu lấy từ: khuôn ảnh quen của trang, định dạng trang khai, và loại ảnh
 * của bài gốc. Không có tín hiệu nào thì để model tự chọn theo nội dung.
 */
function formatBlock(input: ConceptInput): string {
  const list = POST_FORMATS.map((f) => `- ${f.id} (${f.label}): gồm ${f.includes}. Hợp khi ${f.fitsWhen}.`).join("\n");

  const signals: string[] = [...(input.pageFormatHints || [])];
  const fromSource = formatFromImageKind(input.source?.imageReading?.imageKind);
  if (fromSource) signals.push(`Bài gốc thuộc thể loại: ${fromSource}`);

  return `=== THỂ LOẠI POST (chọn theo nhóm tổng quan) ===
${list}
${signals.length ? `\nTín hiệu trang này hay đăng gì:\n${signals.map((x) => `- ${x}`).join("\n")}\n` : ""}`;
}

const APPEARANCE_WORDS =
  /\b(wearing|dressed|in a (?:suit|shirt|dress|hat|cap)|with (?:a )?(?:beard|glasses|hat|cap|mane|fur)|(?:brown|black|white|golden|grey|gray) (?:horse|bear|bull|cat|dog|fur|hair)|horse|bear|bull|stallion)\b/i;

/**
 * Lọc phương án model trả về.
 *
 * Không tin model tuân thủ quy tắc ngoại hình: nó vẫn hay lén thêm "a horse in a
 * suit". Câu nào lọt thì cắt phần tả ngoại hình đi chứ không bỏ cả phương án.
 */
export function sanitizeConcepts(raw: any, allowedNames: string[], max: number): ImageConcept[] {
  const list = Array.isArray(raw?.concepts) ? raw.concepts : Array.isArray(raw) ? raw : [];
  const allowed = new Set(allowedNames);
  const str = (v: any) => (typeof v === "string" && v.trim() ? v.trim() : "");

  // Bỏ mệnh đề tả ngoại hình nằm sau dấu phẩy: "Gèn, a horse in a suit, is pointing"
  // → "Gèn is pointing". Chỉ cắt khi chắc là ngoại hình, không đụng phần còn lại.
  const stripAppearance = (text: string) =>
    text
      .replace(/,\s*(?:a|an|the)\s+[^,]{0,80}?,/gi, (m) => (APPEARANCE_WORDS.test(m) ? "" : m))
      .replace(/\s{2,}/g, " ")
      .trim();

  // Chữ hiện trên ảnh phải ngắn: Gemini vẽ chữ dài là sai dấu. Cắt cứng ở đây
  // chứ không chỉ dặn trong prompt, vì model không phải lúc nào cũng nghe.
  const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

  const out: ImageConcept[] = [];
  for (const c of list) {
    if (!c || typeof c !== "object") continue;
    const format: PostFormatId = isPostFormatId(c.format) ? c.format : "cartoon";

    const panels: ConceptPanel[] = (Array.isArray(c.panels) ? c.panels : [])
      .filter((p: any) => p && typeof p === "object" && str(p.scene))
      .map((p: any) => ({
        scene: stripAppearance(str(p.scene)),
        action: stripAppearance(str(p.action)),
        expression: str(p.expression),
        dialogue: str(p.dialogue) || null,
      }));

    const messages: ConceptMessage[] = (Array.isArray(c.messages) ? c.messages : [])
      .filter((m: any) => m && typeof m === "object" && str(m.text))
      .slice(0, 6)
      .map((m: any) => ({ from: str(m.from) || "Ai đó", text: clip(str(m.text), 80) }));

    let review: ConceptReview | null = null;
    if (c.review && typeof c.review === "object" && str(c.review.text)) {
      const rating = Math.round(Number(c.review.rating));
      review = {
        business: str(c.review.business) || "Quán Không Tên",
        rating: Number.isFinite(rating) ? Math.min(5, Math.max(1, rating)) : 1,
        reviewer: str(c.review.reviewer) || "Khách vãng lai",
        text: clip(str(c.review.text), 280),
        reply: str(c.review.reply) ? clip(str(c.review.reply), 200) : null,
      };
    }

    const caption = str(c.caption) ? clip(str(c.caption), 160) : null;

    // Mỗi thể loại cần đúng phần nội dung của nó — thiếu thì không vẽ được gì.
    const usable =
      format === "cartoon"
        ? panels.length > 0
        : format === "chat" || format === "social"
        ? messages.length > 0
        : format === "review"
        ? !!review
        : !!caption || panels.length > 0;
    if (!usable) continue;

    out.push({
      format,
      title: str(c.title) || `Phương án ${out.length + 1}`,
      why: str(c.why),
      layout:
        str(c.layout) ||
        (format === "cartoon" ? (panels.length === 1 ? "1 khung" : `${panels.length} khung`) : format),
      // Chỉ giữ tên được cấp: model tự đặt tên mới là ra nhân vật lạ không có ảnh mẫu.
      characters: (Array.isArray(c.characters) ? c.characters : [])
        .map((n: any) => String(n).trim())
        .filter((n: string) => allowed.has(n)),
      panels,
      ...(messages.length ? { messages } : {}),
      ...(review ? { review } : {}),
      ...(caption ? { caption } : {}),
    });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Khuôn JSON ép Gemini trả đúng hình dạng phương án.
 *
 * Lỗi đã gặp ở production: chỉ dặn "trả JSON" trong prompt thì model vẫn trả
 * về một dạng mà bộ đọc không nhận ra, và cả luồng tự vẽ ảnh chết theo. Có
 * khuôn thì chính Gemini chịu trách nhiệm đúng hình dạng.
 */
export const CONCEPT_SCHEMA = {
  type: "object",
  properties: {
    concepts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          format: { type: "string", enum: POST_FORMATS.map((f) => f.id) },
          title: { type: "string" },
          why: { type: "string" },
          layout: { type: "string" },
          characters: { type: "array", items: { type: "string" } },
          caption: { type: "string", nullable: true },
          messages: {
            type: "array",
            items: {
              type: "object",
              properties: { from: { type: "string" }, text: { type: "string" } },
              required: ["from", "text"],
            },
          },
          review: {
            type: "object",
            nullable: true,
            properties: {
              business: { type: "string" },
              rating: { type: "number" },
              reviewer: { type: "string" },
              text: { type: "string" },
              reply: { type: "string", nullable: true },
            },
            required: ["business", "rating", "reviewer", "text"],
          },
          panels: {
            type: "array",
            items: {
              type: "object",
              properties: {
                scene: { type: "string" },
                action: { type: "string" },
                expression: { type: "string" },
                dialogue: { type: "string", nullable: true },
              },
              required: ["scene", "action", "expression"],
            },
          },
        },
        // panels không bắt buộc nữa: chat/review/thẻ chữ không có khung.
        required: ["format", "title", "why", "layout"],
      },
    },
  },
  required: ["concepts"],
};

/**
 * Đọc JSON model trả về, chịu được các dạng hay gặp.
 *
 * Bộ đọc cũ cắt từ dấu "{" đầu tới "}" cuối — hỏng ngay khi model trả về một
 * MẢNG ở ngoài cùng ([{...},{...}] thành {...},{...}, không phải JSON hợp lệ).
 * Giờ thử lần lượt: nguyên văn → bỏ khung ```json → cắt theo mảng → cắt theo
 * object.
 */
export function parseLooseJson(raw: string): any {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const attempts: string[] = [text];
  const a1 = text.indexOf("[");
  const a2 = text.lastIndexOf("]");
  const o1 = text.indexOf("{");
  const o2 = text.lastIndexOf("}");
  // Dạng nào mở trước thì thử trước: "[{" là mảng, "{" là object.
  if (a1 >= 0 && a2 > a1 && (o1 < 0 || a1 < o1)) attempts.push(text.slice(a1, a2 + 1));
  if (o1 >= 0 && o2 > o1) attempts.push(text.slice(o1, o2 + 1));

  for (const t of attempts) {
    try {
      return JSON.parse(t);
    } catch {
      // thử dạng tiếp theo
    }
  }
  throw new Error("JSON không hợp lệ");
}

export async function proposeImageConcepts(
  input: ConceptInput,
  count = 3,
  // Tiêm được để test không phải gọi mạng.
  generate: (prompt: string) => Promise<string> = (p) =>
    generateTextGemini(p, { responseSchema: CONCEPT_SCHEMA }),
): Promise<ImageConcept[]> {
  const prompt = buildConceptPrompt(input, count);

  // Thử hai lần: lần đầu hỏng thường là do model trả lệch dạng một lần, gọi lại
  // là được. Hỏng cả hai thì báo lỗi kèm đoạn đầu câu trả lời để biết vì sao.
  let lastRaw = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const raw = await generate(prompt);
    lastRaw = raw;
    let parsed: any;
    try {
      parsed = parseLooseJson(raw);
    } catch {
      console.warn(
        `[image-concepts] Lần ${attempt}: không đọc được JSON. Đoạn đầu câu trả lời: ${JSON.stringify(raw.slice(0, 300))}`,
      );
      continue;
    }
    const concepts = sanitizeConcepts(parsed, input.characterNames, count);
    if (concepts.length > 0) return concepts;
    console.warn(
      `[image-concepts] Lần ${attempt}: đọc được JSON nhưng không có phương án dùng được. Đoạn đầu: ${JSON.stringify(raw.slice(0, 300))}`,
    );
  }

  throw new Error(
    lastRaw.trim()
      ? "Model trả về phương án ảnh không đúng dạng, thử hai lần vẫn hỏng."
      : "Model không trả lời khi đề xuất phương án ảnh.",
  );
}
