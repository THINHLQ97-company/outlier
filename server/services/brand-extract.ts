// Bóc brand profile từ tài liệu đã nạp — cưỡng chế nguyên tắc P1 (docs/PRD.md §2):
// "thông tin nào điền vào profile cũng phải chỉ ra được lấy từ đâu; không tìm thấy
// thì để thiếu, không bịa cho đủ."
//
// Cách cưỡng chế: KHÔNG tin lời model. Sau khi model trả JSON, mỗi câu trích được
// đối chiếu ngược lại văn bản gốc. Câu nào không tìm thấy trong tài liệu → vứt.
// Field mất hết evidence → trả null (để trống), KHÔNG ghi vào DB.
import type { BrandEvidence, BrandField } from "../db/schema";
import { generateTextGemini } from "./gemini-direct";

export interface SourceDoc {
  id: string;
  url?: string;
  text: string;
}

export interface ExtractedProfile {
  sells: BrandField<string[]> | null;
  audience: BrandField<string> | null;
  toneOfVoice: BrandField<string> | null;
  addressing: BrandField<string> | null;
  bannedTerms: BrandField<string[]> | null;
  allowedClaims: BrandField<string[]> | null;
  /** Field bị loại vì không kiểm chứng được — hiển thị cho người dùng biết vì sao thiếu. */
  rejected: { field: string; reason: string; claimedQuote?: string }[];
}

const EMPTY: ExtractedProfile = {
  sells: null, audience: null, toneOfVoice: null,
  addressing: null, bannedTerms: null, allowedClaims: null, rejected: [],
};

/** Chuẩn hoá để so khớp: bỏ khoảng trắng thừa, hạ chữ thường, bỏ dấu câu hai đầu. */
function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").replace(/^[\s"'“”‘’.,;:()\[\]-]+|[\s"'“”‘’.,;:()\[\]-]+$/g, "").trim();
}

/**
 * Tìm câu trích trong tài liệu gốc. Trả offset, hoặc -1 nếu không có.
 * Cố ý khớp khá chặt: chỉ bỏ qua khác biệt khoảng trắng/hoa thường/dấu câu hai đầu.
 * Model paraphrase (viết lại ý) sẽ KHÔNG khớp — và đó đúng là điều ta muốn chặn.
 */
export function findQuote(haystack: string, quote: string): number {
  const q = normalize(quote);
  if (q.length < 8) return -1; // trích quá ngắn thì không đủ để kiểm chứng
  const h = normalize(haystack);
  const idx = h.indexOf(q);
  if (idx < 0) return -1;
  // Quy đổi offset của chuỗi đã chuẩn hoá về offset gần đúng trên văn bản gốc.
  const ratio = haystack.length / Math.max(h.length, 1);
  return Math.min(haystack.length - 1, Math.max(0, Math.round(idx * ratio)));
}

/** Giữ lại evidence kiểm chứng được; trả [] nếu không câu nào đứng vững. */
export function verifyEvidence(
  claimed: { quote?: string; source_id?: string }[] | undefined,
  docs: SourceDoc[],
): BrandEvidence[] {
  if (!Array.isArray(claimed)) return [];
  const out: BrandEvidence[] = [];
  for (const c of claimed) {
    const quote = typeof c?.quote === "string" ? c.quote : "";
    if (!quote) continue;
    // Ưu tiên đúng tài liệu model khai; không thấy thì dò toàn bộ tài liệu.
    const ordered = c.source_id ? [...docs].sort((a) => (a.id === c.source_id ? -1 : 1)) : docs;
    for (const d of ordered) {
      const offset = findQuote(d.text, quote);
      if (offset >= 0) {
        out.push({ quote: quote.trim(), sourceId: d.id, sourceUrl: d.url, offset });
        break;
      }
    }
  }
  return out;
}

function buildField<T>(
  name: string,
  value: T | undefined,
  claimedEvidence: any,
  docs: SourceDoc[],
  rejected: ExtractedProfile["rejected"],
  isEmpty: (v: T) => boolean,
): BrandField<T> | null {
  if (value === undefined || value === null || isEmpty(value)) return null;
  const evidence = verifyEvidence(claimedEvidence, docs);
  if (evidence.length === 0) {
    rejected.push({
      field: name,
      reason: "Không tìm thấy câu trích trong tài liệu — bỏ field để tránh bịa.",
      claimedQuote: Array.isArray(claimedEvidence) ? claimedEvidence[0]?.quote : undefined,
    });
    return null;
  }
  return { value, evidence, source: "extracted" };
}

const PROMPT = `Bạn đọc tài liệu giới thiệu của một doanh nghiệp và bóc ra hồ sơ thương hiệu.

QUY TẮC TUYỆT ĐỐI:
- Chỉ ghi thông tin CÓ THẬT trong tài liệu. Không suy diễn, không bịa, không "đoán cho hợp lý".
- Mỗi field phải kèm ít nhất 1 câu trích NGUYÊN VĂN, copy chính xác từng ký tự từ tài liệu.
- KHÔNG viết lại, KHÔNG tóm tắt câu trích. Sao chép đúng nguyên văn.
- Không tìm thấy thông tin cho field nào thì bỏ hẳn field đó khỏi JSON. Thiếu thì để thiếu.

Trả về DUY NHẤT một object JSON theo dạng:
{
  "sells": { "value": ["sản phẩm/dịch vụ"], "evidence": [{"source_id":"...","quote":"nguyên văn"}] },
  "audience": { "value": "khách hàng là ai", "evidence": [...] },
  "tone_of_voice": { "value": "cách nói chuyện", "evidence": [...] },
  "addressing": { "value": "xưng hô: gọi khách là gì, tự xưng là gì", "evidence": [...] },
  "banned_terms": { "value": ["từ không nên dùng"], "evidence": [...] },
  "allowed_claims": { "value": ["công dụng sản phẩm được phép nói"], "evidence": [...] }
}

TÀI LIỆU:
`;

export async function extractBrandProfile(docs: SourceDoc[]): Promise<ExtractedProfile> {
  const usable = docs.filter((d) => d.text && d.text.trim().length > 50);
  if (usable.length === 0) return { ...EMPTY };

  const corpus = usable
    .map((d) => `--- [source_id: ${d.id}] ${d.url || "(tài liệu tải lên)"} ---\n${d.text.slice(0, 40_000)}`)
    .join("\n\n");

  let raw: string;
  try {
    raw = await generateTextGemini(PROMPT + corpus);
  } catch (e: any) {
    console.warn("[brand-extract] gọi Gemini lỗi:", e?.message || e);
    return { ...EMPTY };
  }

  let parsed: any;
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(m ? m[0] : raw);
  } catch {
    console.warn("[brand-extract] model trả về không phải JSON hợp lệ");
    return { ...EMPTY };
  }

  const rejected: ExtractedProfile["rejected"] = [];
  const emptyStr = (v: string) => !v || !v.trim();
  const emptyArr = (v: string[]) => !Array.isArray(v) || v.length === 0;

  return {
    sells: buildField("sells", parsed?.sells?.value, parsed?.sells?.evidence, usable, rejected, emptyArr),
    audience: buildField("audience", parsed?.audience?.value, parsed?.audience?.evidence, usable, rejected, emptyStr),
    toneOfVoice: buildField("toneOfVoice", parsed?.tone_of_voice?.value, parsed?.tone_of_voice?.evidence, usable, rejected, emptyStr),
    addressing: buildField("addressing", parsed?.addressing?.value, parsed?.addressing?.evidence, usable, rejected, emptyStr),
    bannedTerms: buildField("bannedTerms", parsed?.banned_terms?.value, parsed?.banned_terms?.evidence, usable, rejected, emptyArr),
    allowedClaims: buildField("allowedClaims", parsed?.allowed_claims?.value, parsed?.allowed_claims?.evidence, usable, rejected, emptyArr),
    rejected,
  };
}
