// Nối một fanpage đã khai trong hồ sơ thương hiệu với Meta, rồi quét bài của
// chính page đó về làm tài liệu để bóc tính cách.
//
// Đường đi: Page Access Token → Graph API đọc bài → gộp thành một tài liệu →
// nạp vào brand_sources như mọi nguồn khác → brand_extract bóc ra hồ sơ kèm câu
// trích. Cố ý đi qua brand_sources thay vì ghi thẳng vào hồ sơ: như vậy mọi mục
// bóc được vẫn truy ngược về bài thật có link, đúng nguyên tắc không bịa.
//
// Bóc được từ bài đã đăng: giọng nói, xưng hô, câu cửa miệng, chủ đề, định dạng,
// nhịp đăng. KHÔNG bóc được: "không bao giờ làm" — bài vi phạm thì đã không tồn
// tại để mà đọc, nên phần đó vẫn phải chủ trang tự khai bằng brand_set.
import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { brandFanpages, brandSources } from "../db/schema";
import { fetchPageInfo, fetchPagePosts, postsToDocument, type MetaPageInfo } from "./meta-graph";
import { encryptToken, decryptToken } from "./meta-token";

// Những đoạn đường dẫn của Facebook không bao giờ là tên page.
const NOT_A_PAGE_SLUG = new Set([
  "profile.php", "pages", "groups", "people", "watch", "marketplace",
  "events", "story.php", "photo.php", "permalink.php", "share", "sharer",
]);

/**
 * Lấy mã page từ link fanpage. Nhận cả ba dạng hay gặp:
 *   facebook.com/pages/ten-page/123456   → 123456
 *   facebook.com/profile.php?id=123456   → 123456
 *   facebook.com/tenpage                 → tenpage (Graph tra được bằng username)
 */
export function guessPageIdFromUrl(url: string): string | null {
  const byQuery = /[?&]id=(\d{5,})/.exec(url);
  if (byQuery) return byQuery[1];
  const byPath = /facebook\.com\/(?:pages\/[^/]+\/)?(\d{5,})(?:\/|$|\?)/.exec(url);
  if (byPath) return byPath[1];
  // Tên rút gọn: Graph API tra được page bằng username y như bằng mã số.
  const bySlug = /(?:facebook|fb)\.com\/([A-Za-z0-9._-]{3,})(?:\/|$|\?)/.exec(url);
  if (bySlug && !NOT_A_PAGE_SLUG.has(bySlug[1].toLowerCase())) return bySlug[1];
  return null;
}

export interface ConnectResult {
  fanpageId: string;
  page: MetaPageInfo;
}

/**
 * Kiểm tra token rồi mới lưu. Không bao giờ cất một token chưa dùng thử được:
 * token hỏng nằm im trong DB sẽ khiến lần quét sau thất bại ở chỗ khó lần ra.
 */
export async function connectFanpageMeta(
  fanpageRowId: string,
  pageAccessToken: string,
  explicitPageId?: string,
): Promise<ConnectResult> {
  const db = getDb();
  const [row] = await db.select().from(brandFanpages).where(eq(brandFanpages.id, fanpageRowId));
  if (!row) throw new Error("Không tìm thấy fanpage trong hồ sơ thương hiệu.");

  const pageId = (explicitPageId || row.metaPageId || guessPageIdFromUrl(row.pageUrl) || "").trim();
  if (!pageId) {
    // Trước đây chỗ này lùi về "me". Với Page Access Token thì "me" đúng là
    // page, nhưng với User Access Token "me" lại là tài khoản cá nhân — nối
    // xong sẽ quét nhầm dòng thời gian của người dùng mà không báo gì.
    throw new Error(
      "Không đoán được mã page từ link này. Nhập thẳng Page ID (lấy ở Trang → Giới thiệu → " +
        "ID trang, hoặc gọi me/accounts trong Graph API Explorer).",
    );
  }

  const page = await fetchPageInfo(pageId, pageAccessToken);
  // Token của người dùng cũng gọi lọt endpoint này, và khi đó trả về hồ sơ cá
  // nhân chứ không phải page. Page luôn có category; tài khoản cá nhân thì không.
  if (!page.category && page.followers == null) {
    throw new Error(
      `"${page.name}" trông không phải một Trang (không có hạng mục lẫn số người theo dõi). ` +
        "Nhiều khả năng đây là tài khoản cá nhân — kiểm tra lại Page ID và token.",
    );
  }

  await db
    .update(brandFanpages)
    .set({
      metaPageId: page.id,
      metaTokenEnc: encryptToken(pageAccessToken),
      metaConnectedAt: new Date(),
      pageName: row.pageName || page.name,
      handle: row.handle || (page.username ? `@${page.username}` : null),
      followerCount: page.followers ?? row.followerCount,
    })
    .where(eq(brandFanpages.id, fanpageRowId));

  return { fanpageId: fanpageRowId, page };
}

export async function disconnectFanpageMeta(fanpageRowId: string): Promise<void> {
  await getDb()
    .update(brandFanpages)
    .set({ metaTokenEnc: null, metaConnectedAt: null })
    .where(eq(brandFanpages.id, fanpageRowId));
}

export interface SyncResult {
  fanpageId: string;
  pageName: string;
  postCount: number;
  sourceId: string;
  charCount: number;
  /** Tỉ lệ bài có video — gợi ý nên remake theo hướng bài viết hay video. */
  videoRatio: number;
  note: string;
}

/**
 * Quét bài về và nạp thành một nguồn tài liệu mới.
 *
 * Mỗi lần quét tạo một nguồn mới thay vì đè lên nguồn cũ: các câu trích trong
 * hồ sơ đang trỏ tới nguồn cũ, đè đi là làm hỏng đường truy ngược.
 */
export async function syncFanpagePosts(fanpageRowId: string, limit = 100): Promise<SyncResult> {
  const db = getDb();
  const [row] = await db.select().from(brandFanpages).where(eq(brandFanpages.id, fanpageRowId));
  if (!row) throw new Error("Không tìm thấy fanpage trong hồ sơ thương hiệu.");
  if (!row.metaTokenEnc) throw new Error("Fanpage này chưa nối với Meta — cần Page Access Token trước.");
  if (!row.metaPageId) throw new Error("Chưa biết mã page của Meta — nối lại để lấy.");

  const token = decryptToken(row.metaTokenEnc);
  const page = await fetchPageInfo(row.metaPageId, token);
  const posts = await fetchPagePosts(row.metaPageId, token, limit);
  if (posts.length === 0) {
    throw new Error("Không lấy được bài nào có chữ. Page chưa đăng bài, hoặc token thiếu quyền pages_read_engagement.");
  }

  const doc = postsToDocument(page, posts);
  const [source] = await db
    .insert(brandSources)
    .values({
      brandId: row.brandId,
      kind: "fanpage",
      sourceUrl: page.link || row.pageUrl,
      title: `${page.name} — ${posts.length} bài gần nhất (${new Date().toISOString().slice(0, 10)})`,
      extractedText: doc,
      charCount: doc.length,
      status: "ready",
    })
    .returning({ id: brandSources.id });

  const videoCount = posts.filter((p) => p.mediaType === "video").length;
  const videoRatio = Math.round((videoCount / posts.length) * 100) / 100;

  await db
    .update(brandFanpages)
    .set({
      metaLastSyncAt: new Date(),
      metaLastPostCount: posts.length,
      followerCount: page.followers ?? row.followerCount,
    })
    .where(eq(brandFanpages.id, fanpageRowId));

  return {
    fanpageId: fanpageRowId,
    pageName: page.name,
    postCount: posts.length,
    sourceId: source.id,
    charCount: doc.length,
    videoRatio,
    note:
      `Đã nạp ${posts.length} bài thành tài liệu. Gọi brand_extract để bóc giọng nói, xưng hô, ` +
      `chủ đề từ chính bài của page (mỗi mục sẽ kèm câu trích có link). Riêng "không bao giờ làm" ` +
      `thì bài đã đăng không nói được — phần đó chủ trang tự khai bằng brand_set.`,
  };
}
