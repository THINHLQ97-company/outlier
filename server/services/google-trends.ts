// Đọc xu hướng tìm kiếm từ Google Trends.
//
// Vì sao đáng có: đây là nguồn trend DUY NHẤT vừa thật vừa miễn phí vừa không
// cần đăng ký gì. Google phát nó ra dưới dạng RSS công khai, không API key,
// không giới hạn gọi rõ ràng. Mọi nguồn trend khác trong tầm tay đều hoặc tốn
// tiền (Apify) hoặc phải có người đẩy vào (Claude tự search).
//
// Giới hạn phải nói rõ: đây là thứ người ta đang TÌM KIẾM, không phải thứ đang
// lan trên mạng xã hội. Một từ khoá lên top tìm kiếm vì đang có chuyện, nhưng
// bản thân nó không cho biết người ta đang nói gì về chuyện đó — muốn biết thì
// phải đọc tin bên dưới, hoặc hỏi Claude.
const RSS_URL = "https://trends.google.com/trending/rss";
// Đường cũ, giữ làm dự phòng: Google đã đổi sang đường trên nhưng đường này vẫn
// sống, và khi một bên hỏng thì bên kia thường vẫn chạy.
const RSS_URL_FALLBACK = "https://trends.google.com/trends/trendingsearches/daily/rss";

const TIMEOUT_MS = 15_000;

export interface GoogleTrendNews {
  title: string;
  url: string;
  source?: string;
}

export interface GoogleTrendItem {
  title: string;
  /** Lượng tìm kiếm ước lượng, Google trả dạng chữ: "20K+", "1M+". */
  approxTraffic?: string;
  publishedAt?: string;
  pictureUrl?: string;
  /** Vài tin báo chí Google gắn kèm — đây mới là chỗ biết chuyện gì đang xảy ra. */
  news: GoogleTrendNews[];
}

function decodeEntities(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

function pick(block: string, tag: string): string | undefined {
  // Thẻ của Google Trends có tiền tố namespace (ht:approx_traffic) và không có
  // thuộc tính, nên khớp đơn giản là đủ — không cần bộ phân tích XML đầy đủ.
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(block);
  return m ? decodeEntities(m[1]) : undefined;
}

export function parseTrendsRss(xml: string): GoogleTrendItem[] {
  const items: GoogleTrendItem[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const block = m[1];
    const title = pick(block, "title");
    if (!title) continue;

    const news: GoogleTrendNews[] = [];
    for (const n of block.matchAll(/<ht:news_item>([\s\S]*?)<\/ht:news_item>/gi)) {
      const nb = n[1];
      const nTitle = pick(nb, "ht:news_item_title");
      const nUrl = pick(nb, "ht:news_item_url");
      if (nTitle && nUrl) news.push({ title: nTitle, url: nUrl, source: pick(nb, "ht:news_item_source") });
    }

    items.push({
      title,
      approxTraffic: pick(block, "ht:approx_traffic"),
      publishedAt: pick(block, "pubDate"),
      pictureUrl: pick(block, "ht:picture"),
      news,
    });
  }
  return items;
}

async function fetchRss(url: string, geo: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${url}?geo=${encodeURIComponent(geo)}`, {
      signal: ctrl.signal,
      // Không có User-Agent thì Google hay trả 429.
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Outlier/1.0)" },
    });
    if (!res.ok) throw new Error(`Google Trends trả ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Lấy xu hướng tìm kiếm trong ngày.
 * `geo` theo mã quốc gia hai chữ, mặc định VN.
 */
export async function fetchGoogleTrends(geo = "VN", limit = 20): Promise<GoogleTrendItem[]> {
  let xml: string;
  try {
    xml = await fetchRss(RSS_URL, geo);
  } catch (e: any) {
    // Thử đường cũ trước khi chịu thua — hai đường hiếm khi hỏng cùng lúc.
    try {
      xml = await fetchRss(RSS_URL_FALLBACK, geo);
    } catch {
      throw new Error(`Không đọc được Google Trends: ${e?.message || e}`);
    }
  }
  return parseTrendsRss(xml).slice(0, Math.max(1, limit));
}

/** Gộp trend và mấy tin kèm theo thành một đoạn tóm tắt để lưu vào Xu hướng. */
export function trendToSummary(item: GoogleTrendItem): string {
  const parts: string[] = [];
  if (item.approxTraffic) parts.push(`Khoảng ${item.approxTraffic} lượt tìm kiếm.`);
  if (item.news.length) {
    parts.push("Tin liên quan:");
    for (const n of item.news.slice(0, 3)) {
      parts.push(`- ${n.title}${n.source ? ` (${n.source})` : ""}: ${n.url}`);
    }
  } else {
    // Nói rõ thay vì để trống: người đọc cần biết đây là từ khoá trần, chưa có
    // câu chuyện đi kèm để bắt trend.
    parts.push("Google chưa gắn tin nào cho từ khoá này — cần tự tìm hiểu chuyện gì đang xảy ra.");
  }
  return parts.join("\n");
}
