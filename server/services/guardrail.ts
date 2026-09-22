// Guardrail cho bản remake — cưỡng chế 4 nguyên tắc ở docs/PRD.md §2 bằng CODE,
// không bằng lời dặn trong prompt (model sẽ lách khi bí).
//
//   P2 — không bê nguyên câu chữ bài gốc
//   P3 — không tự chế công dụng sản phẩm
//   P4 — không tự đổi giọng brand (từ cấm, xưng hô)
//
// P1 (không bịa thông tin brand) đã được cưỡng chế từ trước ở brand-extract.ts.
import type { BrandField } from "../db/schema";

export type Severity = "block" | "warn";

export interface GuardrailIssue {
  code: "copied_text" | "unverified_claim" | "banned_term" | "wrong_addressing";
  severity: Severity;
  message: string;
  /** Đoạn văn bản có vấn đề, để giao diện tô sáng đúng chỗ. */
  excerpt?: string;
  /** Vị trí trong bản remake (chỉ số ký tự). */
  atIndex?: number;
  hint?: string;
}

export interface GuardrailReport {
  passed: boolean;      // false = có lỗi mức "block", không cho xuất
  issues: GuardrailIssue[];
  checkedAt: string;
  stats: { maxOverlapWords: number; wordCount: number };
}

/** Ngưỡng trùng lặp: 7 từ liên tiếp trở lên coi là bê nguyên văn (docs/PRD.md §2). */
export const COPY_NGRAM = 7;

/**
 * Tách từ cho tiếng Việt: giữ chữ có dấu, bỏ dấu câu.
 * Cố ý KHÔNG dùng regex \w — \w không hiểu chữ tiếng Việt và sẽ cắt vụn từ.
 */
export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
}

/** Bỏ dấu tiếng Việt để so khớp "lỏng" (dùng cho từ cấm, tránh lách bằng cách bỏ dấu). */
export function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D");
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Tìm một cụm từ theo RANH GIỚI TỪ. Trả về vị trí, hoặc -1.
 *
 * Vì sao phải cẩn thận khi bỏ dấu: "chữa" bỏ dấu thành "chua", trùng với "chưa"
 * — một từ xuất hiện khắp nơi trong tiếng Việt. So khớp lỏng kiểu đó gây báo
 * động giả liên tục, và người dùng sẽ học cách phớt lờ mọi cảnh báo.
 *
 * Quy tắc: luôn khớp bản CÓ DẤU theo ranh giới từ. Chỉ khớp thêm bản KHÔNG DẤU
 * khi cụm có từ 2 chữ trở lên — cụm dài thì trùng ngẫu nhiên gần như không xảy
 * ra, nên vẫn chặn được kiểu lách "gia re" mà không kêu oan với từ đơn.
 */
export function matchTerm(haystack: string, term: string): number {
  const t = term.trim().toLowerCase();
  if (!t) return -1;
  const hay = haystack.toLowerCase();
  const boundary = (pattern: string) =>
    new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, "u");

  const exact = boundary(escapeRe(t)).exec(hay);
  if (exact) return exact.index;

  if (t.split(/\s+/).filter(Boolean).length >= 2) {
    const m = boundary(escapeRe(stripDiacritics(t))).exec(stripDiacritics(hay));
    if (m) return m.index;
  }
  return -1;
}

/**
 * P2 — tìm đoạn trùng nguyên văn với bài gốc.
 * Trả về đoạn trùng DÀI NHẤT tìm được cùng độ dài của nó.
 */
export function findCopiedSpans(
  draft: string,
  source: string,
  minWords = COPY_NGRAM,
): { spans: { words: string[]; atIndex: number }[]; maxOverlap: number } {
  const draftWords = tokenize(draft);
  const srcWords = tokenize(source);
  if (draftWords.length < minWords || srcWords.length < minWords) {
    return { spans: [], maxOverlap: 0 };
  }

  // Băm mọi n-gram của bài gốc để tra cứu nhanh.
  const srcGrams = new Set<string>();
  for (let i = 0; i + minWords <= srcWords.length; i++) {
    srcGrams.add(srcWords.slice(i, i + minWords).join(" "));
  }

  const spans: { words: string[]; atIndex: number }[] = [];
  let maxOverlap = 0;
  let i = 0;
  while (i + minWords <= draftWords.length) {
    const gram = draftWords.slice(i, i + minWords).join(" ");
    if (!srcGrams.has(gram)) { i++; continue; }

    // Kéo dài đoạn trùng ra xa nhất có thể để báo cho đúng phạm vi.
    let end = i + minWords;
    while (end < draftWords.length) {
      const next = draftWords.slice(end - minWords + 1, end + 1).join(" ");
      if (!srcGrams.has(next)) break;
      end++;
    }
    const words = draftWords.slice(i, end);
    maxOverlap = Math.max(maxOverlap, words.length);
    // Tìm vị trí gần đúng trong văn bản gốc của bản nháp để giao diện tô sáng.
    const probe = words.slice(0, 3).join(" ");
    const atIndex = Math.max(0, draft.toLowerCase().indexOf(probe));
    spans.push({ words, atIndex });
    i = end; // không báo trùng chồng lấn
  }
  return { spans, maxOverlap };
}

export interface BrandGuard {
  bannedTerms?: BrandField<string[]> | null;
  addressing?: BrandField<string> | null;
  allowedClaims?: BrandField<string[]> | null;
  sells?: BrandField<string[]> | null;
}

/** P4 — bắt từ ngữ brand đã cấm (so khớp cả khi bỏ dấu để tránh lách). */
export function findBannedTerms(draft: string, banned: string[]): GuardrailIssue[] {
  const issues: GuardrailIssue[] = [];
  for (const term of banned) {
    const t = term.trim().toLowerCase();
    if (!t) continue;
    const idx = matchTerm(draft, t);
    if (idx >= 0) {
      issues.push({
        code: "banned_term",
        severity: "block",
        message: `Dùng từ mà thương hiệu đã dặn tránh: "${term}"`,
        excerpt: draft.slice(Math.max(0, idx - 30), idx + t.length + 30).trim(),
        atIndex: idx,
        hint: "Thay bằng cách diễn đạt khác đúng giọng thương hiệu.",
      });
    }
  }
  return issues;
}

/**
 * P3 — bắt khẳng định về sản phẩm không có trong hồ sơ brand.
 * Cách làm: tìm các câu có từ ngữ mang tính CAM KẾT/CON SỐ, rồi đối chiếu xem
 * nội dung câu đó có khớp công dụng đã được duyệt không. Không khớp → cảnh báo
 * để người duyệt xem lại, KHÔNG tự ý xoá (tránh chặn nhầm câu vô hại).
 */
const CLAIM_MARKERS = [
  "cam kết", "đảm bảo", "bảo đảm", "100%", "tuyệt đối", "duy nhất", "số 1", "số một",
  "tốt nhất", "nhanh nhất", "rẻ nhất", "hàng đầu", "chữa", "trị dứt", "khỏi hẳn",
  "hoàn tiền", "miễn phí trọn đời", "vĩnh viễn", "tăng gấp", "gấp đôi", "gấp ba",
];

export function findUnverifiedClaims(draft: string, allowed: string[]): GuardrailIssue[] {
  const issues: GuardrailIssue[] = [];
  const sentences = draft.split(/(?<=[.!?…])\s+|\n+/).filter((s) => s.trim());
  const allowedFlat = allowed.map((a) => stripDiacritics(a.toLowerCase()));

  let cursor = 0;
  for (const sent of sentences) {
    const at = draft.indexOf(sent, cursor);
    cursor = at >= 0 ? at + sent.length : cursor;

    const marker = CLAIM_MARKERS.find((m) => matchTerm(sent, m) >= 0);
    if (!marker) continue;
    const flat = stripDiacritics(sent.toLowerCase());

    // Câu này có khớp công dụng nào đã được duyệt không?
    const backed = allowedFlat.some((a) => {
      const words = a.split(/\s+/).filter((w) => w.length > 3);
      if (words.length === 0) return false;
      const hit = words.filter((w) => flat.includes(w)).length;
      return hit / words.length >= 0.5; // quá nửa từ khoá của công dụng xuất hiện
    });
    if (backed) continue;

    issues.push({
      code: "unverified_claim",
      severity: "block",
      message: `Câu này khẳng định mạnh ("${marker}") nhưng không khớp công dụng nào trong hồ sơ thương hiệu.`,
      excerpt: sent.trim().slice(0, 200),
      atIndex: at >= 0 ? at : undefined,
      hint: allowed.length
        ? "Sửa cho khớp công dụng đã duyệt, hoặc bỏ khẳng định này."
        : "Hồ sơ thương hiệu chưa ghi công dụng nào được phép nói — bổ sung trước khi dùng câu khẳng định.",
    });
  }
  return issues;
}

/** P4 — kiểm tra xưng hô nếu brand có quy định. */
export function checkAddressing(draft: string, addressing: string): GuardrailIssue[] {
  // Trích các cách xưng hô được đặt trong ngoặc kép ở mô tả của brand.
  const quoted = [...addressing.matchAll(/["“”']([^"“”']{1,20})["“”']/g)].map((m) => m[1].trim().toLowerCase());
  if (quoted.length === 0) return [];
  // Người ta hay viết gộp mấy lựa chọn vào một cặp ngoặc: "t/mẹ/má" nghĩa là ba
  // cách xưng chứ không phải một cụm phải xuất hiện nguyên vẹn. Tách ra, nếu
  // không thì bài xưng "má" vẫn bị báo là sai xưng hô.
  const variants = quoted.flatMap((q) =>
    q.split(/[/,|]/).map((v) => v.trim()).filter(Boolean),
  );
  const used = variants.some((q) => matchTerm(draft, q) >= 0);
  if (used) return [];
  return [{
    code: "wrong_addressing",
    severity: "warn",
    message: `Chưa thấy cách xưng hô quen thuộc của thương hiệu (${quoted.map((q) => `"${q}"`).join(", ")}).`,
    hint: "Kiểm tra lại xem bài có đang xưng hô đúng kiểu thương hiệu vẫn dùng không.",
  }];
}

/** Chạy toàn bộ guardrail trên một bản nháp. */
export function runGuardrail(
  draft: string,
  opts: { sourceText?: string | null; brand?: BrandGuard | null },
): GuardrailReport {
  const issues: GuardrailIssue[] = [];
  const words = tokenize(draft);

  // P2 — bê nguyên câu chữ
  let maxOverlap = 0;
  if (opts.sourceText) {
    const { spans, maxOverlap: m } = findCopiedSpans(draft, opts.sourceText);
    maxOverlap = m;
    for (const s of spans) {
      issues.push({
        code: "copied_text",
        severity: "block",
        message: `Trùng ${s.words.length} từ liên tiếp với bài gốc — đây là bê nguyên văn, không phải học cách triển khai.`,
        excerpt: s.words.join(" ").slice(0, 200),
        atIndex: s.atIndex,
        hint: "Viết lại đoạn này bằng lời của thương hiệu, giữ cách triển khai chứ không giữ câu chữ.",
      });
    }
  }

  const b = opts.brand;
  if (b?.bannedTerms?.value?.length) issues.push(...findBannedTerms(draft, b.bannedTerms.value));
  issues.push(...findUnverifiedClaims(draft, b?.allowedClaims?.value || []));
  if (b?.addressing?.value) issues.push(...checkAddressing(draft, b.addressing.value));

  return {
    passed: !issues.some((i) => i.severity === "block"),
    issues,
    checkedAt: new Date().toISOString(),
    stats: { maxOverlapWords: maxOverlap, wordCount: words.length },
  };
}
