// Đọc bài đã đăng của một Fanpage bằng Page Access Token của chính chủ.
//
// Vì sao đi đường này thay vì Apify: page của mình thì Graph API cho đọc đầy đủ,
// miễn phí, có cả số liệu từng bài. Apify chỉ thấy phần công khai và tính tiền
// theo từng kết quả. Apify vẫn giữ nguyên vai trò của nó — đọc page NGƯỜI KHÁC.
//
// Token được lưu ở dạng mã hoá (xem meta-token.ts); ở đây chỉ nhận token đã giải.
const GRAPH = "https://graph.facebook.com/v21.0";

export interface MetaPageInfo {
  id: string;
  name: string;
  username?: string;
  category?: string;
  followers?: number;
  about?: string;
  link?: string;
}

export interface MetaPost {
  id: string;
  message: string;
  createdTime: string;
  permalink?: string;
  likes: number;
  comments: number;
  shares: number;
  /** Bài có ảnh/video hay chỉ chữ — quyết định remake theo hướng bài viết hay video. */
  mediaType: "text" | "photo" | "video" | "link" | "other";
}

async function graphGet(path: string, token: string, params: Record<string, string> = {}): Promise<any> {
  const url = new URL(`${GRAPH}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", token);

  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.error) {
    // Thông báo của Meta nói khá rõ lỗi gì (token hết hạn, thiếu quyền, sai id)
    // nên chuyển nguyên văn thay vì nuốt đi rồi báo chung chung.
    const e = body?.error || {};
    throw new Error(`Meta Graph lỗi${e.code ? ` (mã ${e.code})` : ""}: ${e.message || res.statusText}`);
  }
  return body;
}

/** Kiểm tra token và lấy thông tin page. Gọi trước khi lưu để không cất token hỏng. */
export async function fetchPageInfo(pageId: string, token: string): Promise<MetaPageInfo> {
  let d: any;
  try {
    d = await graphGet(pageId, token, {
      fields: "id,name,username,category,followers_count,fan_count,about,link",
    });
  } catch (e: any) {
    // Graph báo "nonexisting field (category)" khi đối tượng không phải Trang —
    // tài khoản cá nhân không có hạng mục. Nguyên văn lỗi đó không giúp gì cho
    // người dùng, nên hỏi lại tên rồi nói thẳng vấn đề.
    if (/nonexisting field \(category\)/i.test(e?.message || "")) {
      let who = "";
      try {
        const basic = await graphGet(pageId, token, { fields: "id,name" });
        who = basic?.name ? ` Graph trả về "${basic.name}".` : "";
      } catch {
        // Không lấy được cả tên thì thôi, thông báo bên dưới vẫn đủ ý.
      }
      throw new Error(
        `"${pageId}" không phải một Trang.${who} Thường là do token đang dùng là User Access Token ` +
          `chứ không phải Page Access Token. Trong Graph API Explorer gọi ` +
          `me/accounts?fields=id,name,access_token để lấy đúng token của Trang — nếu Trang cần dùng ` +
          `không có trong danh sách đó thì app chưa được cấp quyền cho Trang, phải cấp trước.`,
      );
    }
    throw e;
  }
  return {
    id: String(d.id),
    name: d.name || "",
    username: d.username || undefined,
    category: d.category || undefined,
    followers: d.followers_count ?? d.fan_count ?? undefined,
    about: d.about || undefined,
    link: d.link || undefined,
  };
}

function mediaTypeOf(p: any): MetaPost["mediaType"] {
  const t = String(p.attachments?.data?.[0]?.media_type || "").toLowerCase();
  if (t === "video") return "video";
  if (t === "photo" || t === "album") return "photo";
  if (t === "link") return "link";
  if (p.message && !p.attachments) return "text";
  return t ? "other" : "text";
}

function countOf(p: any, key: string): number {
  return p?.[key]?.summary?.total_count ?? 0;
}

/**
 * Lấy các bài gần nhất, tự lật trang cho tới khi đủ `limit`.
 * Bài không có chữ (chỉ ảnh, chỉ chia sẻ) bị loại: bóc giọng cần có chữ để trích.
 */
export async function fetchPagePosts(pageId: string, token: string, limit = 100): Promise<MetaPost[]> {
  const out: MetaPost[] = [];
  let after: string | undefined;
  const perPage = Math.min(100, Math.max(25, limit));

  // Trần 10 vòng: page lớn có hàng chục nghìn bài, không lật vô hạn.
  for (let page = 0; page < 10 && out.length < limit; page++) {
    const params: Record<string, string> = {
      fields:
        "id,message,created_time,permalink_url,attachments{media_type}," +
        "likes.summary(true).limit(0),comments.summary(true).limit(0),shares",
      limit: String(perPage),
    };
    if (after) params.after = after;

    const d = await graphGet(`${pageId}/posts`, token, params);
    const rows: any[] = Array.isArray(d.data) ? d.data : [];
    if (rows.length === 0) break;

    for (const p of rows) {
      const message = String(p.message || "").trim();
      if (!message) continue;
      out.push({
        id: String(p.id),
        message,
        createdTime: p.created_time,
        permalink: p.permalink_url,
        likes: countOf(p, "likes"),
        comments: countOf(p, "comments"),
        shares: p.shares?.count ?? 0,
        mediaType: mediaTypeOf(p),
      });
      if (out.length >= limit) break;
    }

    after = d.paging?.cursors?.after;
    if (!after || !d.paging?.next) break;
  }

  return out;
}

/**
 * Gom các bài thành một tài liệu để bóc hồ sơ.
 *
 * Định dạng có chủ ý: mỗi bài là một khối có link và số tương tác ngay trên
 * đầu. Nhờ vậy câu trích mà brand_extract lấy ra luôn truy ngược được về bài
 * thật, và model thấy luôn bài nào ăn khách để ưu tiên học giọng từ bài đó.
 */
export function postsToDocument(page: MetaPageInfo, posts: MetaPost[]): string {
  const head = [
    `Fanpage: ${page.name}${page.username ? ` (@${page.username})` : ""}`,
    page.category ? `Hạng mục: ${page.category}` : "",
    page.followers != null ? `Người theo dõi: ${page.followers}` : "",
    page.about ? `Giới thiệu: ${page.about}` : "",
    `Số bài lấy về: ${posts.length}`,
    "",
    "--- CÁC BÀI ĐÃ ĐĂNG (mới nhất trước) ---",
  ]
    .filter(Boolean)
    .join("\n");

  const body = posts
    .map((p, i) => {
      const meta = `[Bài ${i + 1}] ${p.createdTime} · ${p.mediaType} · ${p.likes} like · ${p.comments} bình luận · ${p.shares} chia sẻ${p.permalink ? ` · ${p.permalink}` : ""}`;
      return `${meta}\n${p.message}`;
    })
    .join("\n\n");

  return `${head}\n\n${body}\n`;
}

/** Bài nào vượt trội so với chính page này — dùng để học giọng từ bài ăn khách. */
export function topPosts(posts: MetaPost[], n = 10): MetaPost[] {
  const score = (p: MetaPost) => p.likes + p.comments * 3 + p.shares * 5;
  return [...posts].sort((a, b) => score(b) - score(a)).slice(0, n);
}
