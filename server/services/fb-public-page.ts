// Lấy số người theo dõi của một TRANG FACEBOOK KHÔNG PHẢI CỦA MÌNH, miễn phí.
//
// Vì sao đáng thử dù không chắc ăn: Apify tính tiền theo kết quả trả về, và số
// người theo dõi thường không nằm trong dữ liệu bài viết — mua thêm một lượt
// quét chỉ để lấy một con số là lãng phí. Graph API thì không tính tiền.
//
// Nhưng phải nói thẳng giới hạn: đọc dữ liệu công khai của trang NGƯỜI KHÁC cần
// quyền "Page Public Content Access", và quyền đó Meta bắt duyệt ứng dụng. App
// chưa được duyệt thì Graph từ chối — không phải lỗi cấu hình, mà là chính sách.
// Nên ở đây: thử, thất bại thì nói rõ vì sao và chỉ sang đường nhập tay, chứ
// không im lặng để người dùng tưởng công cụ hỏng.
import { eq, isNotNull } from "drizzle-orm";
import { getDb, isDbConfigured } from "../db/client";
import { brandFanpages } from "../db/schema";
import { decryptToken } from "./meta-token";

const GRAPH = "https://graph.facebook.com/v21.0";
const TIMEOUT_MS = 15_000;

/** Rút mã trang hoặc tên đường dẫn từ link fanpage. */
export function pageRefFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/facebook\.com$/i.test(u.hostname.replace(/^www\./, ""))) return null;

    // .../profile.php?id=1234567890
    const id = u.searchParams.get("id");
    if (id && /^\d+$/.test(id)) return id;

    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length === 0) return null;

    // .../pages/Tên-Trang/1234567890
    if (parts[0].toLowerCase() === "pages" && parts.length >= 3 && /^\d+$/.test(parts[2])) return parts[2];

    // .../<handle> hoặc .../<handle>/posts/...
    const handle = parts[0];
    if (["profile.php", "people", "groups", "watch", "share"].includes(handle.toLowerCase())) return null;
    return handle.replace(/^@/, "") || null;
  } catch {
    return null;
  }
}

/** Token Meta bất kỳ đang có trong hệ thống — dùng để gọi Graph. */
async function anyMetaToken(): Promise<string | null> {
  if (!isDbConfigured()) return null;
  const rows = await getDb()
    .select()
    .from(brandFanpages)
    .where(isNotNull(brandFanpages.metaTokenEnc))
    .limit(5);
  for (const r of rows) {
    try {
      if (r.metaTokenEnc) return decryptToken(r.metaTokenEnc);
    } catch {
      // Giải mã hỏng thì thử trang khác.
    }
  }
  return null;
}

export interface PublicPageStats {
  followers: number | null;
  name?: string;
  pictureUrl?: string;
  /** Vì sao không lấy được — để nói với người dùng thay vì im lặng. */
  reason?: string;
}

/**
 * Hỏi Graph số người theo dõi của một trang công khai.
 *
 * Trả về `followers: null` kèm `reason` thay vì ném lỗi: đây là việc "được thì
 * tốt", không được cũng không chặn luồng quét.
 */
export async function fetchPublicPageFollowers(channelUrl: string): Promise<PublicPageStats> {
  const ref = pageRefFromUrl(channelUrl);
  if (!ref) return { followers: null, reason: "Không đọc được mã trang từ đường dẫn này." };

  const token = await anyMetaToken();
  if (!token) {
    return {
      followers: null,
      reason:
        "Chưa có token Meta nào trong hệ thống để gọi Graph. Nối một trang của bạn ở mục Thương hiệu là dùng được.",
    };
  }

  const url = new URL(`${GRAPH}/${encodeURIComponent(ref)}`);
  url.searchParams.set("fields", "id,name,followers_count,fan_count,picture.width(200).height(200)");
  url.searchParams.set("access_token", token);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body?.error) {
      const e = body?.error || {};
      // Mã 10 / 200 ở đây gần như luôn là thiếu Page Public Content Access.
      const needsReview = e.code === 10 || e.code === 200 || /public content access/i.test(e.message || "");
      return {
        followers: null,
        reason: needsReview
          ? "Meta không cho đọc dữ liệu công khai của trang người khác khi ứng dụng chưa được duyệt quyền " +
            "'Page Public Content Access'. Đây là chính sách của Meta, không phải lỗi cấu hình — nhập tay số người theo dõi là xong."
          : `Graph từ chối: ${e.message || res.statusText}`,
      };
    }

    const followers = body?.followers_count ?? body?.fan_count ?? null;
    return {
      followers: typeof followers === "number" ? followers : null,
      name: body?.name || undefined,
      pictureUrl: body?.picture?.data?.url || undefined,
      reason: typeof followers === "number" ? undefined : "Graph trả lời được nhưng không có số người theo dõi.",
    };
  } catch (e: any) {
    return { followers: null, reason: `Không gọi được Graph: ${e?.message || e}` };
  } finally {
    clearTimeout(timer);
  }
}
