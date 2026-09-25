import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  metaAppCreds,
  discoverAppId,
  resolveMetaCreds,
  resetDiscoveredAppId,
  inspectToken,
  checkAndRenew,
  upgradeTokenForPage,
  RENEW_WHEN_DAYS_LEFT,
  WARN_WHEN_DAYS_LEFT,
} from "../services/meta-token-health";

const creds = { appId: "111", appSecret: "sss" };
const DAY = 86_400_000;

// Giả lập Graph API bằng cách thay fetch — các hàm này chỉ gọi mạng qua fetch
// nên không cần tiêm thêm gì.
type Route = (url: URL) => { status?: number; body: any };
let routes: Route[] = [];
const realFetch = globalThis.fetch;

function graph(handler: Route) {
  routes.push(handler);
}

beforeEach(() => {
  routes = [];
  globalThis.fetch = (async (input: any) => {
    // graphGet truyền thẳng đối tượng URL cho fetch, không phải chuỗi.
    const url = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
    for (const r of routes) {
      const out = r(url);
      if (out) return new Response(JSON.stringify(out.body), { status: out.status ?? 200 });
    }
    throw new Error(`Không có route giả cho ${url.pathname}`);
  }) as any;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const debugTokenRoute = (data: any): Route => (url) =>
  url.pathname.endsWith("/debug_token") ? { body: { data } } : (undefined as any);

describe("metaAppCreds — thiếu cấu hình thì tắt êm, không nổ", () => {
  test("thiếu biến môi trường → null", () => {
    const old = { id: process.env.META_APP_ID, secret: process.env.META_APP_SECRET };
    delete process.env.META_APP_ID;
    delete process.env.META_APP_SECRET;
    assert.equal(metaAppCreds(), null);
    if (old.id) process.env.META_APP_ID = old.id;
    if (old.secret) process.env.META_APP_SECRET = old.secret;
  });

  test("chỉ có App ID mà thiếu Secret cũng coi như chưa cấu hình", () => {
    const old = { id: process.env.META_APP_ID, secret: process.env.META_APP_SECRET };
    process.env.META_APP_ID = "111";
    process.env.META_APP_SECRET = "   ";
    assert.equal(metaAppCreds(), null);
    if (old.id) process.env.META_APP_ID = old.id; else delete process.env.META_APP_ID;
    if (old.secret) process.env.META_APP_SECRET = old.secret; else delete process.env.META_APP_SECRET;
  });
});

describe("inspectToken — đọc đúng hạn token", () => {
  test("expires_at = 0 nghĩa là KHÔNG hết hạn, đó là đích cần tới", async () => {
    graph(debugTokenRoute({ is_valid: true, expires_at: 0, scopes: ["pages_read_engagement"] }));
    const out = await inspectToken("t", creds);
    assert.equal(out.neverExpires, true);
    assert.equal(out.status, "active");
    assert.equal(out.expiresAt, null);
  });

  test("còn nhiều ngày → active, và tính đúng số ngày còn lại", async () => {
    graph(debugTokenRoute({ is_valid: true, expires_at: Math.floor((Date.now() + 45 * DAY) / 1000) }));
    const out = await inspectToken("t", creds);
    assert.equal(out.status, "active");
    // Làm tròn xuống (và expires_at chỉ tính theo giây) nên 45 ngày ra 44–45.
    // Hụt về phía ít hơn là đúng hướng: báo còn ít thì gia hạn sớm, không muộn.
    assert.ok(out.daysLeft === 44 || out.daysLeft === 45, `đang là ${out.daysLeft}`);
    assert.equal(out.neverExpires, false);
  });

  test("còn ít ngày → expiring, để giao diện kịp cảnh báo", async () => {
    graph(debugTokenRoute({ is_valid: true, expires_at: Math.floor((Date.now() + 3 * DAY) / 1000) }));
    const out = await inspectToken("t", creds);
    assert.equal(out.status, "expiring");
    assert.ok(out.daysLeft! <= WARN_WHEN_DAYS_LEFT);
  });

  test("quá hạn → expired và không còn valid", async () => {
    graph(debugTokenRoute({ is_valid: true, expires_at: Math.floor((Date.now() - DAY) / 1000) }));
    const out = await inspectToken("t", creds);
    assert.equal(out.status, "expired");
    assert.equal(out.valid, false);
  });

  test("Meta nói is_valid=false thì tin nó, kể cả còn hạn trên giấy", async () => {
    graph(debugTokenRoute({ is_valid: false, expires_at: Math.floor((Date.now() + 40 * DAY) / 1000) }));
    const out = await inspectToken("t", creds);
    assert.equal(out.status, "expired");
    assert.equal(out.valid, false);
  });

  test("lỗi 190 → expired, không ném ra ngoài", async () => {
    graph((url) =>
      url.pathname.endsWith("/debug_token")
        ? { status: 400, body: { error: { code: 190, message: "Token hết hạn" } } }
        : (undefined as any),
    );
    const out = await inspectToken("t", creds);
    assert.equal(out.status, "expired");
    assert.match(out.note || "", /hết hạn/i);
  });
});

describe("checkAndRenew — tự gia hạn, và biết khi nào KHÔNG cần làm gì", () => {
  test("token vĩnh viễn thì không đổi gì — đổi thêm là thêm một lần có thể hỏng", async () => {
    graph(debugTokenRoute({ is_valid: true, expires_at: 0 }));
    const out = await checkAndRenew({ pageToken: "page", userToken: "user", pageId: "p1" }, creds);
    assert.equal(out.renewed, false);
    assert.equal(out.pageToken, null);
    assert.equal(out.inspection.neverExpires, true);
  });

  test("còn nhiều ngày thì để yên, chưa cần gia hạn", async () => {
    graph(debugTokenRoute({ is_valid: true, expires_at: Math.floor((Date.now() + 50 * DAY) / 1000) }));
    const out = await checkAndRenew({ pageToken: "page", userToken: "user", pageId: "p1" }, creds);
    assert.equal(out.renewed, false);
    assert.ok(out.inspection.daysLeft! > RENEW_WHEN_DAYS_LEFT);
  });

  test("sắp hết hạn → đổi user token rồi lấy lại page token vĩnh viễn", async () => {
    let debugCalls = 0;
    graph((url) => {
      if (url.pathname.endsWith("/debug_token")) {
        debugCalls++;
        // Lần đầu kiểm token cũ (sắp hết), lần sau kiểm token mới (vĩnh viễn).
        return debugCalls === 1
          ? { body: { data: { is_valid: true, expires_at: Math.floor((Date.now() + 5 * DAY) / 1000) } } }
          : { body: { data: { is_valid: true, expires_at: 0 } } };
      }
      if (url.pathname.endsWith("/oauth/access_token")) return { body: { access_token: "user-moi" } };
      if (url.pathname.endsWith("/me/accounts"))
        return { body: { data: [{ id: "p1", name: "Gàn", access_token: "page-moi" }] } };
      return undefined as any;
    });

    const out = await checkAndRenew({ pageToken: "page-cu", userToken: "user-cu", pageId: "p1" }, creds);
    assert.equal(out.renewed, true);
    assert.equal(out.pageToken, "page-moi");
    assert.equal(out.userToken, "user-moi");
    assert.equal(out.inspection.neverExpires, true);
  });

  test("token đã hết hạn cũng thử gia hạn, không bỏ ngay", async () => {
    graph((url) => {
      if (url.pathname.endsWith("/debug_token"))
        return { body: { data: { is_valid: true, expires_at: Math.floor((Date.now() - DAY) / 1000) } } };
      if (url.pathname.endsWith("/oauth/access_token")) return { body: { access_token: "user-moi" } };
      if (url.pathname.endsWith("/me/accounts"))
        return { body: { data: [{ id: "p1", name: "Gàn", access_token: "page-moi" }] } };
      return undefined as any;
    });
    const out = await checkAndRenew({ pageToken: "cu", userToken: null, pageId: "p1" }, creds);
    assert.equal(out.renewed, true);
  });

  test("gia hạn thất bại thì nói rõ phải làm gì, không im lặng", async () => {
    graph((url) => {
      if (url.pathname.endsWith("/debug_token"))
        return { body: { data: { is_valid: true, expires_at: Math.floor((Date.now() + 2 * DAY) / 1000) } } };
      if (url.pathname.endsWith("/oauth/access_token"))
        return { status: 400, body: { error: { code: 190, message: "Session đã hỏng" } } };
      return undefined as any;
    });
    const out = await checkAndRenew({ pageToken: "cu", userToken: null, pageId: "p1" }, creds);
    assert.equal(out.renewed, false);
    assert.match(out.note || "", /nối lại trang/i);
  });

  test("gia hạn được user token nhưng trang không nằm trong đó → giữ user token, báo rõ", async () => {
    graph((url) => {
      if (url.pathname.endsWith("/debug_token"))
        return { body: { data: { is_valid: true, expires_at: Math.floor((Date.now() + 2 * DAY) / 1000) } } };
      if (url.pathname.endsWith("/oauth/access_token")) return { body: { access_token: "user-moi" } };
      if (url.pathname.endsWith("/me/accounts"))
        return { body: { data: [{ id: "khac", name: "Trang khác", access_token: "x" }] } };
      return undefined as any;
    });
    const out = await checkAndRenew({ pageToken: "cu", userToken: "user-cu", pageId: "p1" }, creds);
    assert.equal(out.renewed, false);
    assert.equal(out.pageToken, null);
    assert.equal(out.userToken, "user-moi", "user token mới vẫn phải giữ để lần sau đỡ phải làm lại");
    assert.match(out.note || "", /quyền của ứng dụng/i);
  });
});

describe("upgradeTokenForPage — nâng ngay lúc nối, xoá việc dán tay", () => {
  test("token ngắn hạn được nâng thành page token vĩnh viễn", async () => {
    let debugCalls = 0;
    graph((url) => {
      if (url.pathname.endsWith("/debug_token")) {
        debugCalls++;
        return debugCalls === 1
          ? { body: { data: { is_valid: true, expires_at: Math.floor((Date.now() + 3600_000) / 1000) } } }
          : { body: { data: { is_valid: true, expires_at: 0 } } };
      }
      if (url.pathname.endsWith("/oauth/access_token")) return { body: { access_token: "user-dai-han" } };
      if (url.pathname.endsWith("/me/accounts"))
        return { body: { data: [{ id: "p1", name: "Gàn", access_token: "page-vinh-vien" }] } };
      return undefined as any;
    });
    const out = await upgradeTokenForPage("ngan-han", "p1", creds);
    assert.equal(out.pageToken, "page-vinh-vien");
    assert.equal(out.userToken, "user-dai-han");
    assert.equal(out.changed, true);
    assert.match(out.note, /không phải dán tay/i);
  });

  test("token đã vĩnh viễn thì giữ nguyên, không gọi đổi thêm", async () => {
    let exchanged = false;
    graph((url) => {
      if (url.pathname.endsWith("/debug_token")) return { body: { data: { is_valid: true, expires_at: 0 } } };
      if (url.pathname.endsWith("/oauth/access_token")) {
        exchanged = true;
        return { body: { access_token: "khong-nen-goi" } };
      }
      return undefined as any;
    });
    const out = await upgradeTokenForPage("da-vinh-vien", "p1", creds);
    assert.equal(out.changed, false);
    assert.equal(out.pageToken, "da-vinh-vien");
    assert.equal(exchanged, false, "token đã vĩnh viễn thì không được gọi đổi nữa");
  });

  test("page token không đổi được nhưng còn sống → vẫn dùng, nói rõ chưa tự gia hạn được", async () => {
    graph((url) => {
      if (url.pathname.endsWith("/debug_token"))
        return { body: { data: { is_valid: true, expires_at: Math.floor((Date.now() + 40 * DAY) / 1000) } } };
      if (url.pathname.endsWith("/oauth/access_token"))
        return { status: 400, body: { error: { code: 100, message: "Không đổi được loại token này" } } };
      return undefined as any;
    });
    const out = await upgradeTokenForPage("page-token", "p1", creds);
    assert.equal(out.changed, false);
    assert.equal(out.pageToken, "page-token");
    assert.match(out.note, /USER token/);
  });

  test("token chết và không đổi được thì phải ném lỗi, đừng lưu token vô dụng", async () => {
    graph((url) => {
      if (url.pathname.endsWith("/debug_token"))
        return { status: 400, body: { error: { code: 190, message: "Token hết hạn" } } };
      if (url.pathname.endsWith("/oauth/access_token"))
        return { status: 400, body: { error: { code: 190, message: "Token hết hạn" } } };
      return undefined as any;
    });
    await assert.rejects(() => upgradeTokenForPage("chet", "p1", creds), /không gia hạn được/i);
  });

  test("nhiều trang mà không nói rõ Page ID thì báo lỗi kèm danh sách, không đoán", async () => {
    graph((url) => {
      if (url.pathname.endsWith("/debug_token"))
        return { body: { data: { is_valid: true, expires_at: Math.floor((Date.now() + 3600_000) / 1000) } } };
      if (url.pathname.endsWith("/oauth/access_token")) return { body: { access_token: "user" } };
      if (url.pathname.endsWith("/me/accounts"))
        return {
          body: {
            data: [
              { id: "p1", name: "Gàn", access_token: "a" },
              { id: "p2", name: "Gèn", access_token: "b" },
            ],
          },
        };
      return undefined as any;
    });
    await assert.rejects(() => upgradeTokenForPage("ngan-han", null, creds), /cần Page ID/i);
  });

  test("token hợp lệ nhưng chưa cấp trang nào → chỉ luôn chỗ bật quyền", async () => {
    graph((url) => {
      if (url.pathname.endsWith("/debug_token"))
        return { body: { data: { is_valid: true, expires_at: Math.floor((Date.now() + 3600_000) / 1000) } } };
      if (url.pathname.endsWith("/oauth/access_token")) return { body: { access_token: "user" } };
      if (url.pathname.endsWith("/me/accounts")) return { body: { data: [] } };
      return undefined as any;
    });
    await assert.rejects(() => upgradeTokenForPage("ngan-han", "p1", creds), /business_tools/);
  });
});

describe("discoverAppId / resolveMetaCreds — App ID tự tra, không bắt người dùng đi copy", () => {
  test("token tự soi được thì lấy app_id từ debug_token", async () => {
    graph((url) =>
      url.pathname.endsWith("/debug_token") ? { body: { data: { app_id: "999", is_valid: true } } } : (undefined as any),
    );
    assert.equal(await discoverAppId("t"), "999");
  });

  test("debug_token không cho thì lùi về /app", async () => {
    graph((url) => {
      if (url.pathname.endsWith("/debug_token"))
        return { status: 400, body: { error: { code: 190, message: "Không soi được" } } };
      if (url.pathname.endsWith("/app")) return { body: { id: "888", name: "Outlier" } };
      return undefined as any;
    });
    assert.equal(await discoverAppId("t"), "888");
  });

  test("cả hai đường đều tắc thì trả null, không đoán bừa", async () => {
    graph(() => ({ status: 400, body: { error: { message: "nope" } } }));
    assert.equal(await discoverAppId("t"), null);
  });

  test("có Secret mà thiếu App ID thì tự tra rồi ghép thành creds", async () => {
    resetDiscoveredAppId();
    const old = { id: process.env.META_APP_ID, secret: process.env.META_APP_SECRET };
    delete process.env.META_APP_ID;
    process.env.META_APP_SECRET = "bi-mat";
    graph(debugTokenRoute({ app_id: "777", is_valid: true }));

    const out = await resolveMetaCreds(["token-da-luu"]);
    assert.deepEqual(out, { appId: "777", appSecret: "bi-mat" });

    if (old.id) process.env.META_APP_ID = old.id;
    if (old.secret) process.env.META_APP_SECRET = old.secret; else delete process.env.META_APP_SECRET;
    resetDiscoveredAppId();
  });

  test("tra được một lần thì nhớ, không hỏi Meta lại mỗi lượt", async () => {
    resetDiscoveredAppId();
    const old = { id: process.env.META_APP_ID, secret: process.env.META_APP_SECRET };
    delete process.env.META_APP_ID;
    process.env.META_APP_SECRET = "bi-mat";
    let calls = 0;
    graph((url) => {
      if (url.pathname.endsWith("/debug_token")) {
        calls++;
        return { body: { data: { app_id: "777", is_valid: true } } };
      }
      return undefined as any;
    });

    await resolveMetaCreds(["t"]);
    await resolveMetaCreds(["t"]);
    assert.equal(calls, 1, `hỏi Meta ${calls} lần, đáng ra 1`);

    if (old.id) process.env.META_APP_ID = old.id;
    if (old.secret) process.env.META_APP_SECRET = old.secret; else delete process.env.META_APP_SECRET;
    resetDiscoveredAppId();
  });

  test("token đầu chết thì thử token sau, đừng bỏ cuộc", async () => {
    resetDiscoveredAppId();
    const old = { id: process.env.META_APP_ID, secret: process.env.META_APP_SECRET };
    delete process.env.META_APP_ID;
    process.env.META_APP_SECRET = "bi-mat";
    graph((url) => {
      if (!url.pathname.endsWith("/debug_token") && !url.pathname.endsWith("/app")) return undefined as any;
      const t = url.searchParams.get("input_token") || url.searchParams.get("access_token");
      if (t === "chet") return { status: 400, body: { error: { code: 190, message: "hỏng" } } };
      return { body: { data: { app_id: "666", is_valid: true } } };
    });

    const out = await resolveMetaCreds(["chet", "con-song"]);
    assert.equal(out?.appId, "666");

    if (old.id) process.env.META_APP_ID = old.id;
    if (old.secret) process.env.META_APP_SECRET = old.secret; else delete process.env.META_APP_SECRET;
    resetDiscoveredAppId();
  });

  test("KHÔNG có Secret thì đừng cố tra — Secret chỉ chủ app có, tra App ID cũng vô ích", async () => {
    resetDiscoveredAppId();
    const old = { id: process.env.META_APP_ID, secret: process.env.META_APP_SECRET };
    delete process.env.META_APP_ID;
    delete process.env.META_APP_SECRET;
    let called = false;
    graph(() => {
      called = true;
      return { body: { data: { app_id: "555" } } };
    });
    assert.equal(await resolveMetaCreds(["t"]), null);
    assert.equal(called, false, "không có Secret thì đừng gọi Meta cho tốn");
    if (old.id) process.env.META_APP_ID = old.id;
    if (old.secret) process.env.META_APP_SECRET = old.secret;
    resetDiscoveredAppId();
  });
});
