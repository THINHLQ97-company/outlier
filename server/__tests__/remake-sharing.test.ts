import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";

// Thư viện remake dùng chung (task #5985): ai đăng nhập cũng XEM và VẼ THÊM
// được; SỬA CHỮ / XOÁ / ĐĂNG / ĐỔI ẢNH ĐANG CHỌN chỉ chủ và admin.
// Canh bằng mã nguồn vì các route này nối Express + DB, chạy thật cần cả hệ thống.
const src = fs.readFileSync(path.join(process.cwd(), "server", "routes", "remakes.routes.ts"), "utf8");

/** Thân một route, từ dòng khai báo tới route kế tiếp. */
function routeBody(signature: string): string {
  const start = src.indexOf(signature);
  assert.ok(start >= 0, `không thấy route ${signature}`);
  const next = src.indexOf("\n  app.", start + signature.length);
  return src.slice(start, next < 0 ? undefined : next);
}

const OWNER_CHECK = /row\.owner !== \w+ && !\(await isActiveAdmin/;

describe("XEM — ai đăng nhập cũng được", () => {
  test("danh sách không lọc theo người tạo", () => {
    const body = routeBody('app.get("/api/remakes", ');
    assert.doesNotMatch(body, /eq\(remakes\.owner/, "còn lọc theo owner — mỗi người chỉ thấy bản của mình");
  });

  test("danh sách trả kèm cờ quyền để giao diện ẩn nút", () => {
    assert.match(routeBody('app.get("/api/remakes", '), /canEdit:/);
  });

  test("chi tiết không chặn người không phải chủ", () => {
    assert.doesNotMatch(routeBody('app.get("/api/remakes/:id", '), OWNER_CHECK);
  });

  test("xuất CSV dùng chung", () => {
    assert.doesNotMatch(routeBody('app.get("/api/remakes/export.csv"'), /eq\(remakes\.owner/);
  });
});

describe("VẼ THÊM — ai cũng được, nhưng không đổi ảnh đang chọn của chủ", () => {
  test("đề xuất phương án không chặn", () => {
    assert.doesNotMatch(routeBody('app.post("/api/remakes/:id/concepts"'), OWNER_CHECK);
  });

  test("vẽ ảnh không chặn, và chỉ chủ mới tự chọn ảnh mới", () => {
    const body = routeBody('app.post("/api/remakes/:id/image", ');
    assert.doesNotMatch(body, OWNER_CHECK);
    assert.match(body, /selectAfter: owner/);
  });

  test("chỉnh ảnh không chặn, và chỉ chủ mới đổi ảnh đang chọn", () => {
    const body = routeBody('app.post("/api/remakes/:id/image/edit"');
    assert.doesNotMatch(body, OWNER_CHECK);
    assert.match(body, /owner \? \{ selectedImageUrl: newUrl \}/);
  });
});

describe("SỬA / XOÁ / ĐĂNG / CHỌN ẢNH — vẫn chỉ chủ và admin", () => {
  for (const sig of [
    'app.post("/api/remakes/:id/revise"',
    'app.post("/api/remakes/:id/recheck"',
    'app.post("/api/remakes/:id/publish"',
    'app.post("/api/remakes/:id/select-image"',
    'app.delete("/api/remakes/:id/images"',
    'app.delete("/api/remakes/:id", ',
  ]) {
    test(`${sig} còn chặn người không phải chủ`, () => {
      assert.match(routeBody(sig), OWNER_CHECK);
    });
  }
});
