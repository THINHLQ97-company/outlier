import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";

// Kênh theo dõi dùng chung (task #6208): ai đăng nhập cũng XEM, LÀM MỚI, SỬA
// SỐ LIỆU được; GHI CHÚ / TẠM DỪNG / BỎ THEO DÕI chỉ người thêm kênh và admin.
// Canh bằng mã nguồn vì route nối Express + DB, chạy thật cần cả hệ thống.
const src = fs.readFileSync(path.join(process.cwd(), "server", "routes", "channels.routes.ts"), "utf8");

function routeBody(signature: string): string {
  const start = src.indexOf(signature);
  assert.ok(start >= 0, `không thấy route ${signature}`);
  const next = src.indexOf("\n  app.", start + signature.length);
  return src.slice(start, next < 0 ? undefined : next);
}

const OWNER_GATE = /isActiveAdmin|canManageChannel/;

describe("ai đăng nhập cũng dùng được", () => {
  test("danh sách không lọc theo người thêm", () => {
    const body = routeBody('app.get("/api/channels", ');
    assert.doesNotMatch(body, /eq\(watchedChannels\.owner/);
    assert.match(body, /canEdit:/);
    assert.match(body, /isMine:/);
  });

  test("xem bài của kênh không chặn theo chủ", () => {
    const body = routeBody('app.get("/api/channels/:id/items", ');
    assert.doesNotMatch(body, /status\(403\)/);
    assert.match(body, /canEdit:/);
  });

  test("làm mới kênh không chặn theo chủ", () => {
    assert.doesNotMatch(routeBody('app.post("/api/channels/:id/refresh", '), OWNER_GATE);
  });

  test("sửa số liệu cũ không chặn theo chủ", () => {
    assert.doesNotMatch(routeBody('app.post("/api/channels/:id/repair", '), OWNER_GATE);
  });

  test("thêm kênh kiểm trùng trên toàn danh sách, trả id kênh có sẵn", () => {
    const body = routeBody('app.post("/api/channels", ');
    assert.doesNotMatch(body, /and\(eq\(watchedChannels\.owner/);
    assert.match(body, /status\(409\)[\s\S]*id: existing\.id/);
  });
});

describe("chỉ người thêm kênh và admin", () => {
  test("bỏ theo dõi", () => {
    assert.match(routeBody('app.delete("/api/channels/:id", '), /canManageChannel\(chan, username\)/);
  });

  test("ghi chú / tạm dừng bị chặn, số người theo dõi thì không", () => {
    const body = routeBody('app.patch("/api/channels/:id", ');
    assert.match(body, /touchesOwnerFields && !\(await canManageChannel/);
    const gate = body.indexOf("touchesOwnerFields &&");
    const follower = body.indexOf("req.body?.followerCount !== undefined");
    assert.ok(gate >= 0 && follower > gate);
    // Số người theo dõi không nằm trong điều kiện chặn.
    assert.doesNotMatch(body.slice(body.indexOf("const touchesOwnerFields"), gate), /followerCount/);
  });

  test("canManageChannel = chủ hoặc admin", () => {
    assert.match(src, /chan\.owner === username \|\| \(await isActiveAdmin\(username\)\)/);
  });
});
