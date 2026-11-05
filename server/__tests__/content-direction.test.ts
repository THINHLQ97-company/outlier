import test from "node:test";
import assert from "node:assert/strict";
import { contentDirectionBlock, DIRECTION_MAX_CHARS } from "../services/content-direction";

test("không trang nào có content direction → khối rỗng", () => {
  assert.equal(contentDirectionBlock([{ pageUrl: "https://facebook.com/a" }]), "");
});
test("đưa nguyên văn kèm tên trang và nguồn; nhiều trang thì nhắc không trộn giọng", () => {
  const out = contentDirectionBlock([
    { pageName: "Gàn và Gèn", pageUrl: "x", contentDirectionUrl: "https://a", contentDirectionText: "Ba trụ nội dung", contentDirectionFetchedAt: "2026-11-05T00:00:00Z" },
    { pageName: "ATALT", pageUrl: "y", contentDirectionUrl: "https://b", contentDirectionText: "Năm trục" },
  ]);
  assert.match(out, /Content direction — Gàn và Gèn \(đọc ngày 2026-11-05\)/);
  assert.match(out, /Ba trụ nội dung/);
  assert.match(out, /Năm trục/);
  assert.match(out, /không trộn giọng/);
});
test("cắt ở trần ký tự", () => {
  const out = contentDirectionBlock([{ pageUrl: "x", contentDirectionText: "a".repeat(DIRECTION_MAX_CHARS + 500) }]);
  assert.ok(!out.includes("a".repeat(DIRECTION_MAX_CHARS + 1)));
});
