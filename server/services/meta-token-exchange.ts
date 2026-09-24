// Đổi token Meta ngắn hạn thành token page KHÔNG HẾT HẠN.
//
// Vì sao cần: token lấy từ Graph API Explorer là user token ngắn hạn, sống
// khoảng một giờ. Nối trang bằng nó thì sáng mai mở ra là hỏng. Nhiều người
// tưởng phải lấy token mới mỗi ngày — không phải.
//
// Meta có đường đổi ba bước, và bước giữa là chỗ ai cũng bỏ qua:
//   1. user token ngắn hạn  (~1 giờ)   ← Explorer cho cái này
//   2. user token dài hạn   (~60 ngày) ← đổi bằng App ID + App Secret
//   3. PAGE token           (vĩnh viễn) ← lấy từ (2) qua /me/accounts
//
// Page token sinh ra từ user token dài hạn thì KHÔNG có ngày hết hạn. Nó chỉ
// mất hiệu lực khi người dùng đổi mật khẩu, gỡ ứng dụng, hoặc bị Meta thu hồi.
const GRAPH = "https://graph.facebook.com/v21.0";
const TIMEOUT_MS = 20_000;

export interface ExchangeResult {
  /** Page token lấy được, theo từng trang mà tài khoản quản lý. */
  pages: { id: string; name: string; accessToken: string; category?: string }[];
  /** true = token page không còn ngày hết hạn. */
  neverExpires: boolean;
  note: string;
}

async function graphGet(path: string, params: Record<string, string>): Promise<any> {
  const url = new URL(`${GRAPH}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body?.error) {
      const e = body?.error || {};
      if (e.code === 190) throw new Error("Token đã hết hạn hoặc không hợp lệ — lấy token mới từ Graph API Explorer rồi thử lại.");
      if (/app secret/i.test(e.message || "")) throw new Error("App Secret không đúng. Lấy ở developers.facebook.com → app → Settings → Basic.");
      throw new Error(`Meta từ chối: ${e.message || res.statusText}`);
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Đổi token ngắn hạn sang page token vĩnh viễn.
 *
 * App Secret chỉ dùng ngay tại đây rồi bỏ — không lưu lại. Nó là chìa khoá của
 * cả ứng dụng, không phải của riêng một trang, nên giữ lại là rủi ro không cần
 * thiết cho một việc chỉ làm một lần.
 */
export async function exchangeForLongLivedPageTokens(
  appId: string,
  appSecret: string,
  shortLivedToken: string,
): Promise<ExchangeResult> {
  // Bước 2: ngắn hạn → dài hạn
  const longLived = await graphGet("oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: appId.trim(),
    client_secret: appSecret.trim(),
    fb_exchange_token: shortLivedToken.trim(),
  });

  const userToken = String(longLived?.access_token || "");
  if (!userToken) throw new Error("Meta không trả về token dài hạn.");

  // Bước 3: user token dài hạn → page token (không hết hạn)
  const accounts = await graphGet("me/accounts", {
    fields: "id,name,access_token,category",
    limit: "100",
    access_token: userToken,
  });

  const pages = (accounts?.data || [])
    .filter((p: any) => p?.id && p?.access_token)
    .map((p: any) => ({
      id: String(p.id),
      name: String(p.name || ""),
      accessToken: String(p.access_token),
      category: p.category || undefined,
    }));

  if (pages.length === 0) {
    throw new Error(
      "Không thấy trang nào. Tài khoản này chưa cấp quyền cho ứng dụng với trang nào — " +
        "vào facebook.com/settings?tab=business_tools để bật trang cho ứng dụng.",
    );
  }

  // Kiểm chứng thay vì tin lời: hỏi Meta xem token vừa lấy có ngày hết hạn không.
  let neverExpires = false;
  try {
    const debug = await graphGet("debug_token", {
      input_token: pages[0].accessToken,
      access_token: `${appId.trim()}|${appSecret.trim()}`,
    });
    // expires_at = 0 nghĩa là không hết hạn.
    neverExpires = debug?.data?.expires_at === 0;
  } catch {
    // Không kiểm chứng được thì nói là không chắc, đừng khẳng định bừa.
  }

  return {
    pages,
    neverExpires,
    note: neverExpires
      ? `Lấy được ${pages.length} trang. Token của trang KHÔNG có ngày hết hạn — chỉ mất hiệu lực nếu bạn đổi mật khẩu Facebook hoặc gỡ ứng dụng.`
      : `Lấy được ${pages.length} trang. Không kiểm chứng được hạn dùng của token, nhưng token đổi theo đường này thường sống rất lâu.`,
  };
}
