// Viết lại bài cho brand — giữ CÁCH TRIỂN KHAI của bài gốc, thay ruột
// (docs/PRD.md §4 J4).
//
// Điểm mấu chốt: prompt CHỈ nhận công thức triển khai đã bóc ra, KHÔNG nhận
// nguyên văn bài gốc. Model không đọc được câu chữ gốc thì không thể chép lại —
// đây là lớp phòng vệ đầu tiên cho P2. Lớp thứ hai là guardrail đo n-gram sau
// khi sinh xong (server/services/guardrail.ts).
import { generateTextGemini } from "./gemini-direct";
import { runGuardrail, type GuardrailReport, type BrandGuard } from "./guardrail";
import type { DeconstructedStructure, BrandField } from "../db/schema";

export interface BrandContext extends BrandGuard {
  name: string;
  audience?: BrandField<string> | null;
  toneOfVoice?: BrandField<string> | null;
}

export type RemakeFormat = "video_script" | "post";

export interface RemakeOutcome {
  draft: string;
  guardrail: GuardrailReport;
  warning?: string;
}

/** Mô tả brand cho model — CHỈ đưa những gì có thật trong hồ sơ. */
function describeBrand(b: BrandContext): string {
  const lines: string[] = [`TÊN THƯƠNG HIỆU: ${b.name}`];
  const put = (label: string, f?: BrandField<any> | null) => {
    if (!f?.value) return;
    const v = Array.isArray(f.value) ? f.value.join("; ") : String(f.value);
    if (v.trim()) lines.push(`${label}: ${v}`);
  };
  put("BÁN GÌ", b.sells);
  put("KHÁCH HÀNG", b.audience);
  put("GIỌNG ĐIỆU", b.toneOfVoice);
  put("XƯNG HÔ", b.addressing);
  put("CÔNG DỤNG ĐƯỢC PHÉP NÓI", b.allowedClaims);
  put("TỪ NGỮ KHÔNG ĐƯỢC DÙNG", b.bannedTerms);

  // Nói thẳng chỗ nào thiếu, để model biết mà KHÔNG tự điền vào.
  const missing: string[] = [];
  if (!b.sells?.value) missing.push("bán gì");
  if (!b.audience?.value) missing.push("khách hàng là ai");
  if (!b.toneOfVoice?.value) missing.push("giọng điệu");
  if (!b.allowedClaims?.value) missing.push("công dụng được phép nói");
  if (missing.length) {
    lines.push(
      `\nCHƯA CÓ DỮ LIỆU cho: ${missing.join(", ")}. ` +
      `Tuyệt đối KHÔNG tự bịa những mục này. Viết chung chung ở chỗ đó, hoặc bỏ qua.`,
    );
  }
  return lines.join("\n");
}

/** Mô tả công thức triển khai — KHÔNG kèm câu chữ gốc. */
function describeFormula(s: DeconstructedStructure): string {
  const lines: string[] = [];
  if (s.formula) lines.push(`CÔNG THỨC TRIỂN KHAI: ${s.formula}`);
  if (s.hook3s) lines.push(`MỞ ĐẦU (3 giây đầu): thủ pháp "${s.hook3s.technique || s.hook3s.what}"`);
  if (s.problemOpen) lines.push(`MỞ VẤN ĐỀ: cách "${s.problemOpen.how || s.problemOpen.what}"`);
  if (s.retentionBeats?.length) {
    lines.push("NHỊP GIỮ CHÂN:");
    s.retentionBeats.forEach((b, i) => lines.push(`  ${i + 1}. ${b.whyItWorks || b.what}`));
  }
  if (s.twist) lines.push(`ĐIỂM BẺ HƯỚNG: ${s.twist.what}`);
  if (s.cta) lines.push(`CÁCH CHỐT: kiểu "${s.cta.style || s.cta.what}"`);
  return lines.join("\n") || "(chưa bóc được công thức rõ ràng)";
}

function buildPrompt(
  brand: BrandContext,
  structure: DeconstructedStructure,
  format: RemakeFormat,
  note?: string,
  audienceText?: string,
): string {
  const kind = format === "post" ? "một bài đăng mạng xã hội" : "một kịch bản video ngắn (kèm mốc thời gian gợi ý)";
  return `Bạn viết nội dung cho thương hiệu dưới đây. Hãy viết ${kind} MỚI, đi theo CÁCH TRIỂN KHAI đã cho.

QUY TẮC BẮT BUỘC:
1. Học CÁCH TRIỂN KHAI (nhịp, thủ pháp mở, cách giữ chân, cách chốt) — KHÔNG chép nội dung.
2. Toàn bộ nội dung bên trong phải là của thương hiệu này: sản phẩm, khách hàng, bối cảnh của họ.
3. Chỉ nói những công dụng có trong mục "CÔNG DỤNG ĐƯỢC PHÉP NÓI". Không có thì đừng khẳng định gì về hiệu quả.
4. Tuyệt đối tránh các từ trong "TỪ NGỮ KHÔNG ĐƯỢC DÙNG".
5. Giữ đúng giọng điệu và xưng hô của thương hiệu.
6. Mục nào ghi "CHƯA CÓ DỮ LIỆU" thì không được tự bịa.
${audienceText ? `7. Bài gốc đã có người bàn tán — viết bám vào thứ HỌ QUAN TÂM, đừng chỉ bám nội dung bài gốc. Bài nói một đằng người đọc bàn một nẻo là chuyện thường, và thứ họ bàn mới là thứ đáng viết tiếp.` : ""}

${describeBrand(brand)}

${describeFormula(structure)}
${audienceText ? `\n=== NGƯỜI ĐỌC BÀI GỐC QUAN TÂM GÌ ===\n${audienceText}` : ""}
${note ? `\nYÊU CẦU CHỈNH SỬA THÊM: ${note}` : ""}

Trả về DUY NHẤT phần nội dung đã viết, không giải thích, không mở đầu bằng "Đây là...".`;
}

/**
 * Viết bản remake rồi chạy guardrail.
 * `sourceText` (lời thoại bài gốc) chỉ dùng để ĐỐI CHIẾU chống sao chép —
 * không bao giờ đưa vào prompt.
 */
export async function writeRemake(
  brand: BrandContext,
  structure: DeconstructedStructure,
  format: RemakeFormat,
  opts: { sourceText?: string | null; note?: string; audienceText?: string } = {},
): Promise<RemakeOutcome> {
  let draft: string;
  try {
    draft = (
      await generateTextGemini(buildPrompt(brand, structure, format, opts.note, opts.audienceText), {
        asPlainText: true,
      })
    ).trim();
  } catch (e: any) {
    return {
      draft: "",
      guardrail: { passed: false, issues: [], checkedAt: new Date().toISOString(), stats: { maxOverlapWords: 0, wordCount: 0 } },
      warning: `Không viết được bản nháp: ${e?.message || e}`,
    };
  }

  // Phòng xa: nếu model vẫn gói vào JSON thì bóc lấy phần nội dung, đừng để
  // người dùng nhận một cục JSON.
  if (draft.startsWith("{") || draft.startsWith("[")) {
    try {
      const o = JSON.parse(draft);
      const picked = typeof o === "string" ? o
        : o?.content ?? o?.text ?? o?.script ?? o?.draft ?? o?.post ?? null;
      if (typeof picked === "string" && picked.trim()) draft = picked.trim();
    } catch { /* không phải JSON — giữ nguyên */ }
  }

  if (!draft) {
    return {
      draft: "",
      guardrail: { passed: false, issues: [], checkedAt: new Date().toISOString(), stats: { maxOverlapWords: 0, wordCount: 0 } },
      warning: "Kết quả trả về rỗng.",
    };
  }

  const guardrail = runGuardrail(draft, { sourceText: opts.sourceText, brand });
  return { draft, guardrail };
}
