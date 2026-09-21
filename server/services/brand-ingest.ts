// Nạp tài liệu brand: website / fanpage / PDF → văn bản thuần.
//
// Văn bản trích ra ở đây là NGUỒN SỰ THẬT để kiểm chứng evidence về sau
// (xem brand-extract.ts). Vì vậy ưu tiên giữ nguyên văn câu chữ: chỉ bỏ thẻ và
// khoảng trắng thừa, KHÔNG viết lại, KHÔNG tóm tắt, KHÔNG để model chạm vào.

const FETCH_TIMEOUT_MS = 20_000;
const MAX_BYTES = 5 * 1024 * 1024; // 5MB — đủ cho trang giới thiệu, chặn tải nhầm file lớn
const UA = "Mozilla/5.0 (compatible; OutlierBot/1.0; +https://matbao.com)";

export interface IngestResult {
  title?: string;
  text: string;
  charCount: number;
}

/** Giải mã HTML entity phổ biến (không kéo thêm thư viện cho việc nhỏ này). */
function decodeEntities(s: string): string {
  const named: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
    hellip: "…", mdash: "—", ndash: "–", laquo: "«", raquo: "»",
    ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’",
  };
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => named[n.toLowerCase()] ?? m);
}

/**
 * HTML → văn bản thuần, giữ ranh giới câu.
 * Cố ý tự viết thay vì thêm cheerio/jsdom: ta chỉ cần text phẳng, và tự viết thì
 * kiểm soát được việc KHÔNG làm dính chữ giữa hai block (làm dính sẽ khiến câu
 * trích không khớp được về sau).
 */
export function htmlToText(html: string): { title?: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1]).trim() : undefined;

  let s = html;
  // Bỏ hẳn phần không phải nội dung đọc được
  s = s.replace(/<(script|style|noscript|template|svg|iframe)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  // Thẻ khối → xuống dòng, để câu không dính vào nhau
  s = s.replace(/<\/?(p|div|section|article|header|footer|main|aside|nav|br|hr|li|ul|ol|tr|td|th|table|h[1-6]|blockquote|figcaption)[^>]*>/gi, "\n");
  // Thẻ còn lại → khoảng trắng
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  // Gom khoảng trắng nhưng GIỮ xuống dòng làm ranh giới câu
  s = s.replace(/[ \t ]+/g, " ");
  s = s.replace(/\s*\n\s*/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return { title, text: s.trim() };
}

async function fetchWithLimit(url: string): Promise<{ buf: Buffer; contentType: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": UA, "Accept-Language": "vi,en;q=0.8" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const contentType = res.headers.get("content-type") || "";
    const ab = await res.arrayBuffer();
    if (ab.byteLength > MAX_BYTES) throw new Error(`Tài liệu quá lớn (>${MAX_BYTES / 1024 / 1024}MB)`);
    return { buf: Buffer.from(ab), contentType };
  } finally {
    clearTimeout(timer);
  }
}

/** Chặn URL trỏ vào mạng nội bộ — tránh SSRF khi người dùng dán link tuỳ ý. */
export function assertPublicUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("Link không hợp lệ.");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("Chỉ nhận link http/https.");
  }
  const host = u.hostname.toLowerCase();
  const blocked =
    host === "localhost" ||
    host === "0.0.0.0" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local") ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
    /^\[?::1\]?$/.test(host) ||
    /^\[?f[cd][0-9a-f]{2}:/i.test(host);
  if (blocked) throw new Error("Không nhận link trỏ vào mạng nội bộ.");
  return u;
}

/** Nạp một URL (trang web hoặc fanpage) → text. */
export async function ingestUrl(rawUrl: string): Promise<IngestResult> {
  const u = assertPublicUrl(rawUrl);
  const { buf, contentType } = await fetchWithLimit(u.toString());

  if (contentType.includes("application/pdf") || u.pathname.toLowerCase().endsWith(".pdf")) {
    return ingestPdfBuffer(buf);
  }

  const { title, text } = htmlToText(buf.toString("utf8"));
  if (text.length < 50) {
    // Fanpage/SPA render bằng JS → HTML thô gần như rỗng. Nói thẳng thay vì trả text rác.
    throw new Error(
      "Trang này không trả nội dung đọc được (có thể là trang dựng bằng JavaScript hoặc yêu cầu đăng nhập). " +
      "Hãy lưu trang thành PDF rồi tải lên, hoặc dán trực tiếp nội dung.",
    );
  }
  return { title, text, charCount: text.length };
}

/** Nạp PDF từ buffer → text. */
export async function ingestPdfBuffer(buf: Buffer): Promise<IngestResult> {
  // import động: chỉ nạp khi thật sự có PDF, giữ thời gian khởi động server nhẹ.
  const mod: any = await import("pdf-parse");
  const pdfParse = mod.default || mod.pdf || mod;
  const parsed = await pdfParse(buf);
  const text = String(parsed?.text || "").replace(/[ \t ]+/g, " ").replace(/\s*\n\s*/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (text.length < 50) {
    throw new Error("Không đọc được chữ trong PDF (có thể là PDF ảnh scan, chưa nhận dạng được chữ).");
  }
  return { title: parsed?.info?.Title || undefined, text, charCount: text.length };
}

/** Nạp văn bản dán tay. */
export function ingestRawText(text: string): IngestResult {
  const t = text.replace(/\r\n/g, "\n").trim();
  if (t.length < 50) throw new Error("Nội dung quá ngắn để bóc hồ sơ (cần ít nhất 50 ký tự).");
  return { text: t, charCount: t.length };
}
