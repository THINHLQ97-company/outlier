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

export interface ImageConcept {
  /** Tên ngắn tiếng Việt để người dùng phân biệt ba phương án. */
  title: string;
  /** Vì sao phương án này hợp bài — tiếng Việt, dẫn chiếu nội dung bản viết. */
  why: string;
  /** Bố cục: "1 khung", "2 khung ngang", "4 khung dọc"… */
  layout: string;
  panels: ConceptPanel[];
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
=== QUY TẮC BẮT BUỘC ===
1. Ảnh minh hoạ ĐÚNG nội dung bản viết — đọc ảnh xong phải hiểu được ý bài, không phải một cảnh chung chung cùng chủ đề.
2. Bài gốc là truyện tranh/ảnh nhiều khung thì GIỮ ĐÚNG số khung và cách chia khung; nội dung từng khung lấy từ bản viết.
3. ${count} phương án phải KHÁC NHAU THẬT về cách thể hiện (khoảnh khắc khác, bố cục khác, cách gây cười khác) — không phải một ý viết lại ba lần.

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

Trả về DUY NHẤT JSON:
{"concepts":[{"title":"tên ngắn","why":"vì sao hợp bài","layout":"1 khung","characters":["tên"],"panels":[{"scene":"...","action":"...","expression":"...","dialogue":"... hoặc null"}]}]}`;
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

  const out: ImageConcept[] = [];
  for (const c of list) {
    if (!c || typeof c !== "object") continue;
    const panels: ConceptPanel[] = (Array.isArray(c.panels) ? c.panels : [])
      .filter((p: any) => p && typeof p === "object" && str(p.scene))
      .map((p: any) => ({
        scene: stripAppearance(str(p.scene)),
        action: stripAppearance(str(p.action)),
        expression: str(p.expression),
        dialogue: str(p.dialogue) || null,
      }));
    if (panels.length === 0) continue; // không có khung nào thì không vẽ được gì

    out.push({
      title: str(c.title) || `Phương án ${out.length + 1}`,
      why: str(c.why),
      layout: str(c.layout) || (panels.length === 1 ? "1 khung" : `${panels.length} khung`),
      // Chỉ giữ tên được cấp: model tự đặt tên mới là ra nhân vật lạ không có ảnh mẫu.
      characters: (Array.isArray(c.characters) ? c.characters : [])
        .map((n: any) => String(n).trim())
        .filter((n: string) => allowed.has(n)),
      panels,
    });
    if (out.length >= max) break;
  }
  return out;
}

export async function proposeImageConcepts(
  input: ConceptInput,
  count = 3,
  // Tiêm được để test không phải gọi mạng.
  generate: (prompt: string) => Promise<string> = (p) => generateTextGemini(p),
): Promise<ImageConcept[]> {
  const raw = await generate(buildConceptPrompt(input, count));
  let parsed: any;
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new Error("Không đọc được phương án ảnh model trả về.");
  }
  const concepts = sanitizeConcepts(parsed, input.characterNames, count);
  if (concepts.length === 0) throw new Error("Model không đưa ra phương án ảnh nào dùng được.");
  return concepts;
}
