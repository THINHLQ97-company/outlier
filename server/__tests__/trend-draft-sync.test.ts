import test from "node:test";
import assert from "node:assert/strict";
import { pickReadyRemake } from "../services/trend-draft-sync";

const r = (id: string, o: any = {}) => ({ id, owner: "thinhlq", brandId: "b1", deconstructionId: "d1", status: "ready", draft: "nội dung", createdAt: new Date("2026-11-05T01:00:00Z"), ...o });

test("bản nháp đã ready thì giữ nguyên", () => {
  assert.equal(pickReadyRemake({ remakeId: "x", brandId: "b1", status: "ready" }, "d1", [r("y")]), null);
});
test("remake đang gắn đã viết xong → ready", () => {
  assert.equal(pickReadyRemake({ remakeId: "x", brandId: "b1", status: "pending" }, "d1", [r("x")])?.id, "x");
});
test("bấm tạo lại sinh remake mới cùng bản bóc + thương hiệu → lấy bản mới nhất", () => {
  const out = pickReadyRemake({ remakeId: "x", brandId: "b1", status: "pending" }, "d1", [
    r("x", { status: "writing", draft: null }),
    r("old", { createdAt: new Date("2026-11-04T00:00:00Z") }),
    r("new", { createdAt: new Date("2026-11-05T02:00:00Z") }),
  ]);
  assert.equal(out?.id, "new");
});
test("không lấy remake của thương hiệu khác, bản bóc khác, hoặc chưa có nội dung", () => {
  assert.equal(pickReadyRemake({ remakeId: null, brandId: "b1", status: "error" }, "d1", [r("a", { brandId: "b2" }), r("b", { deconstructionId: "d2" }), r("c", { draft: " " })]), null);
  assert.equal(pickReadyRemake({ remakeId: null, brandId: "b1", status: "error" }, null, [r("a")]), null);
});
test("không lấy remake workflow viết cho page khác hoặc đã gắn page khác", () => {
  const d = { remakeId: null, brandId: "b1", status: "error" };
  assert.equal(pickReadyRemake(d, "d1", [r("w", { owner: "trend-workflow" })]), null);
  assert.equal(pickReadyRemake(d, "d1", [r("a")], new Set(["a"])), null);
  assert.equal(pickReadyRemake(d, "d1", [r("a")])?.id, "a");
});
test("bản tạo lại mới hơn bản đang gắn → thẻ trỏ bản mới", () => {
  assert.equal(pickReadyRemake({ remakeId: "x", brandId: "b1", status: "pending" }, "d1", [r("x", { owner: "trend-workflow" }), r("new", { createdAt: new Date("2026-11-06T00:00:00Z") })])?.id, "new");
});
