// Giữ token Meta sống, tự động.
//
// Trước đây người dùng phải tự đi lấy token rồi tự bấm đổi mỗi lần hỏng — và vì
// token từ Graph API Explorer chỉ sống một giờ, "mỗi lần hỏng" là gần như mỗi
// ngày. Việc đó máy làm được, không có lý gì để người làm.
//
// Điều kiện duy nhất: App ID + App Secret phải nằm trong biến môi trường
// (META_APP_ID / META_APP_SECRET). Không có thì không đổi được token nào — Meta
// đòi App Secret cho mọi bước gia hạn. Trước đây cố ý KHÔNG lưu App Secret vì nó
// là chìa khoá cả ứng dụng; nhưng để tự động thì buộc phải có, và để trong env
// (không vào database, không ra client) là chỗ đúng nhất còn lại.
//
// Đường gia hạn — bước giữa là chỗ ai cũng bỏ qua:
//   user token ngắn hạn (~1 giờ)
//     → user token dài hạn (~60 ngày, đổi lại được nhiều lần)
//       → PAGE token (vĩnh viễn)
//
// Nên chiến lược là: giữ user token dài hạn, và mỗi lần chạy thì lấy lại page
// token từ nó. Page token sinh theo đường này không có ngày hết hạn, nên thường
// chẳng phải làm gì — nhưng nếu người dùng dán vào một token ngắn hạn, job này
// sẽ tự nâng nó lên trước khi nó chết.
const GRAPH = "https://graph.facebook.com/v21.0";
const TIMEOUT_MS = 20_000;

/** Còn dưới bấy nhiêu ngày thì gia hạn — đổi sớm còn kịp thử lại nếu lỗi. */
export const RENEW_WHEN_DAYS_LEFT = 30;
/** Còn dưới bấy nhiêu ngày mà chưa gia hạn được thì cảnh báo người dùng. */
export const WARN_WHEN_DAYS_LEFT = 7;

export type TokenStatus = "active" | "expiring" | "expired" | "invalid" | "unknown";

export interface MetaAppCreds {
  appId: string;
  appSecret: string;
}

/** Đọc App ID/Secret từ env. Thiếu → null, và mọi thứ ở đây tự bỏ qua êm. */
export function metaAppCreds(): MetaAppCreds | null {
  const appId = (process.env.META_APP_ID || "").trim();
  const appSecret = (process.env.META_APP_SECRET || "").trim();
  if (!appId || !appSecret) return null;
  return { appId, appSecret };
}

// App ID tự tra được, nhớ lại trong tiến trình để không hỏi Meta mỗi lượt.
let discoveredAppId: string | null = null;

/**
 * Tra App ID từ chính token đã có.
 *
 * Vì sao làm được: token nào cũng do MỘT ứng dụng cấp, và Meta nói ra ứng dụng
 * đó nếu ta hỏi bằng chính token ấy. Nên chỉ App Secret là đủ để chạy — không
 * cần bắt người dùng đi copy thêm App ID, một con số đã nằm sẵn trong dữ liệu.
 *
 * Hai đường, thử lần lượt: debug_token tự soi, rồi /app.
 */
export async function discoverAppId(token: string): Promise<string | null> {
  try {
    const body = await graphGet("debug_token", { input_token: token, access_token: token });
    const id = body?.data?.app_id;
    if (id) return String(id);
  } catch {
    // Token có thể không tự soi được — thử đường thứ hai.
  }
  try {
    const body = await graphGet("app", { fields: "id,name", access_token: token });
    if (body?.id) return String(body.id);
  } catch {
    // Không tra được thì nói không biết, đừng đoán.
  }
  return null;
}

/**
 * Lấy đủ App ID + Secret để làm việc: env trước, thiếu App ID thì tự tra từ
 * token đang có.
 *
 * `tokensForDiscovery` là các token có thể dùng để tra — truyền vài cái vì cái
 * đầu có thể đã chết.
 */
export async function resolveMetaCreds(tokensForDiscovery: string[] = []): Promise<MetaAppCreds | null> {
  const fromEnv = metaAppCreds();
  if (fromEnv) return fromEnv;

  const appSecret = (process.env.META_APP_SECRET || "").trim();
  if (!appSecret) return null; // Secret thì không tra hộ được — chỉ chủ app có.

  if (discoveredAppId) return { appId: discoveredAppId, appSecret };

  for (const token of tokensForDiscovery) {
    if (!token?.trim()) continue;
    const id = await discoverAppId(token.trim());
    if (id) {
      discoveredAppId = id;
      console.log(`[meta-token] Tự tra được App ID ${id} từ token đã lưu — không cần điền META_APP_ID.`);
      return { appId: id, appSecret };
    }
  }
  return null;
}

/** Dùng trong test để quên App ID đã tra. */
export function resetDiscoveredAppId(): void {
  discoveredAppId = null;
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
      const err: any = new Error(e.message || res.statusText || "Meta từ chối yêu cầu.");
      err.code = e.code;
      throw err;
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

export interface TokenInspection {
  valid: boolean;
  neverExpires: boolean;
  expiresAt: Date | null;
  daysLeft: number | null;
  status: TokenStatus;
  scopes: string[];
  note?: string;
}

/**
 * Hỏi Meta xem token còn sống không và còn bao lâu.
 *
 * Dùng app token (`appId|appSecret`) để hỏi, không dùng chính token đang kiểm —
 * token đã chết thì tự nó không hỏi được gì.
 */
export async function inspectToken(token: string, creds: MetaAppCreds): Promise<TokenInspection> {
  let data: any;
  try {
    const body = await graphGet("debug_token", {
      input_token: token,
      access_token: `${creds.appId}|${creds.appSecret}`,
    });
    data = body?.data;
  } catch (e: any) {
    return {
      valid: false,
      neverExpires: false,
      expiresAt: null,
      daysLeft: null,
      status: e?.code === 190 ? "expired" : "invalid",
      scopes: [],
      note: e?.message || "Không kiểm được token.",
    };
  }

  if (!data) {
    return { valid: false, neverExpires: false, expiresAt: null, daysLeft: null, status: "unknown", scopes: [], note: "Meta không trả về thông tin token." };
  }

  const scopes: string[] = Array.isArray(data.scopes) ? data.scopes : [];

  if (data.is_valid === false) {
    return {
      valid: false,
      neverExpires: false,
      expiresAt: null,
      daysLeft: null,
      status: "expired",
      scopes,
      note: data.error?.message || "Token không còn hiệu lực.",
    };
  }

  // expires_at = 0 (hoặc thiếu) nghĩa là KHÔNG hết hạn — đúng thứ ta muốn thấy.
  const raw = typeof data.expires_at === "number" ? data.expires_at : 0;
  if (raw === 0) {
    return { valid: true, neverExpires: true, expiresAt: null, daysLeft: null, status: "active", scopes };
  }

  const expiresAt = new Date(raw * 1000);
  const daysLeft = Math.floor((expiresAt.getTime() - Date.now()) / 86_400_000);
  return {
    valid: daysLeft > 0,
    neverExpires: false,
    expiresAt,
    daysLeft,
    status: daysLeft <= 0 ? "expired" : daysLeft <= WARN_WHEN_DAYS_LEFT ? "expiring" : "active",
    scopes,
  };
}

/** Đổi một token bất kỳ (ngắn hạn hoặc dài hạn) sang user token dài hạn mới. */
export async function extendUserToken(token: string, creds: MetaAppCreds): Promise<string> {
  const body = await graphGet("oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: creds.appId,
    client_secret: creds.appSecret,
    fb_exchange_token: token,
  });
  const next = String(body?.access_token || "");
  if (!next) throw new Error("Meta không trả về token dài hạn.");
  return next;
}

export interface PageToken {
  id: string;
  name: string;
  accessToken: string;
}

/** Lấy page token từ một user token. Page token sinh từ user token dài hạn thì vĩnh viễn. */
export async function pageTokensFrom(userToken: string): Promise<PageToken[]> {
  const body = await graphGet("me/accounts", {
    fields: "id,name,access_token",
    limit: "100",
    access_token: userToken,
  });
  return (body?.data || [])
    .filter((p: any) => p?.id && p?.access_token)
    .map((p: any) => ({ id: String(p.id), name: String(p.name || ""), accessToken: String(p.access_token) }));
}

export interface UpgradeResult {
  /** Token nên lưu để đọc/đăng trên trang. */
  pageToken: string;
  /** User token dài hạn — lưu để lần sau tự gia hạn được. */
  userToken: string | null;
  inspection: TokenInspection;
  /** Đã thật sự đổi token, hay giữ nguyên cái đang có. */
  changed: boolean;
  note: string;
}

/**
 * Nâng một token người dùng vừa dán lên mức bền nhất có thể, NGAY LÚC NỐI TRANG.
 *
 * Đây là chỗ xoá bỏ việc làm tay: người dùng dán token nào cũng được — ngắn hạn
 * từ Explorer, page token, user token dài hạn — hàm này tự đưa nó về page token
 * vĩnh viễn nếu Meta cho phép.
 *
 * `pageId` để chọn đúng trang trong số trang tài khoản quản lý. Không truyền thì
 * lấy trang duy nhất (nhiều trang mà không nói rõ là lỗi, không đoán).
 */
export async function upgradeTokenForPage(
  rawToken: string,
  pageId: string | null,
  creds: MetaAppCreds,
): Promise<UpgradeResult> {
  const token = rawToken.trim();

  // Token đã vĩnh viễn thì thôi, đừng đổi cho có — đổi thêm một lần là thêm một
  // lần có thể hỏng.
  const first = await inspectToken(token, creds);
  if (first.valid && first.neverExpires) {
    return {
      pageToken: token,
      userToken: null,
      inspection: first,
      changed: false,
      note: "Token đã không có ngày hết hạn — giữ nguyên.",
    };
  }

  // Còn hạn hay hết hạn thì vẫn thử đổi: token hết hạn đúng một tiếng trước vẫn
  // đổi được trong nhiều trường hợp, và thử thì không mất gì.
  let userToken: string;
  try {
    userToken = await extendUserToken(token, creds);
  } catch (e: any) {
    // Không đổi được: có thể vì đây đã là PAGE token (page token không đổi qua
    // đường này). Nếu nó còn sống thì cứ dùng, chỉ là chưa tự gia hạn được.
    if (first.valid) {
      return {
        pageToken: token,
        userToken: null,
        inspection: first,
        changed: false,
        note:
          `Chưa nâng được thành token vĩnh viễn (${e?.message || e}). Token hiện tại còn dùng được` +
          (first.daysLeft != null ? ` khoảng ${first.daysLeft} ngày.` : ".") +
          " Dán USER token từ Graph API Explorer thì hệ thống tự nâng và tự gia hạn về sau.",
      };
    }
    throw new Error(`Token không dùng được và không gia hạn được: ${e?.message || e}`);
  }

  const pages = await pageTokensFrom(userToken);
  if (pages.length === 0) {
    throw new Error(
      "Token hợp lệ nhưng tài khoản chưa cấp quyền cho ứng dụng với trang nào — " +
        "vào facebook.com/settings?tab=business_tools để bật trang cho ứng dụng.",
    );
  }

  const picked = pageId ? pages.find((p) => p.id === pageId) : pages.length === 1 ? pages[0] : null;
  if (!picked) {
    const names = pages.map((p) => `${p.name} (${p.id})`).join(", ");
    throw new Error(
      pageId
        ? `Không thấy trang ${pageId} trong số trang token này quản lý. Đang có: ${names}.`
        : `Token này quản lý nhiều trang — cần Page ID để biết lấy trang nào. Đang có: ${names}.`,
    );
  }

  const after = await inspectToken(picked.accessToken, creds);
  return {
    pageToken: picked.accessToken,
    userToken,
    inspection: after,
    changed: true,
    note: after.neverExpires
      ? "Đã nâng thành token trang KHÔNG có ngày hết hạn. Từ giờ không phải dán tay nữa."
      : `Đã đổi token mới${after.daysLeft != null ? `, còn ${after.daysLeft} ngày` : ""}. Hệ thống sẽ tự gia hạn trước khi hết.`,
  };
}

export interface RenewOutcome {
  /** Page token mới, null = giữ nguyên cái đang có. */
  pageToken: string | null;
  /** User token dài hạn mới, null = giữ nguyên. */
  userToken: string | null;
  inspection: TokenInspection;
  renewed: boolean;
  note?: string;
}

/**
 * Một lượt kiểm–và–gia hạn cho một trang. Không ném lỗi: job chạy hằng ngày qua
 * nhiều trang, một trang hỏng không được làm dừng các trang còn lại.
 */
export async function checkAndRenew(
  input: { pageToken: string; userToken: string | null; pageId: string | null },
  creds: MetaAppCreds,
): Promise<RenewOutcome> {
  const inspection = await inspectToken(input.pageToken, creds);

  // Vĩnh viễn và còn sống → không có gì phải làm. Đây là trạng thái mong muốn.
  if (inspection.valid && inspection.neverExpires) {
    return { pageToken: null, userToken: null, inspection, renewed: false };
  }

  const needsWork =
    !inspection.valid || (inspection.daysLeft != null && inspection.daysLeft <= RENEW_WHEN_DAYS_LEFT);
  if (!needsWork) {
    return { pageToken: null, userToken: null, inspection, renewed: false };
  }

  // Ưu tiên user token đã lưu: đó là đường gia hạn chắc chắn. Không có thì thử
  // chính page token, được thì tốt.
  const seed = input.userToken || input.pageToken;
  try {
    const nextUser = await extendUserToken(seed, creds);
    const pages = await pageTokensFrom(nextUser);
    const picked = input.pageId ? pages.find((p) => p.id === input.pageId) : pages.length === 1 ? pages[0] : null;
    if (!picked) {
      return {
        pageToken: null,
        userToken: nextUser,
        inspection,
        renewed: false,
        note: input.pageId
          ? `Gia hạn được user token nhưng không thấy trang ${input.pageId} trong số trang nó quản lý — kiểm tra lại quyền của ứng dụng với trang.`
          : "Gia hạn được user token nhưng trang chưa có Page ID nên không biết lấy token trang nào.",
      };
    }
    const after = await inspectToken(picked.accessToken, creds);
    return {
      pageToken: picked.accessToken,
      userToken: nextUser,
      inspection: after,
      renewed: true,
      note: after.neverExpires ? "Đã gia hạn, token mới không có ngày hết hạn." : "Đã gia hạn token.",
    };
  } catch (e: any) {
    return {
      pageToken: null,
      userToken: null,
      inspection,
      renewed: false,
      note: `Gia hạn tự động thất bại: ${e?.message || e}. Cần nối lại trang bằng token mới từ Graph API Explorer.`,
    };
  }
}
