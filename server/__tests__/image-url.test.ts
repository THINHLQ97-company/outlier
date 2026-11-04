import { test } from "node:test";
import assert from "node:assert/strict";
import { withImageToken } from "../../src/services/image-url";

test("attaches token to plain internal file URL", () => {
  assert.equal(withImageToken("/api/files/a/b.png", "t k"), "/api/files/a/b.png?token=t%20k");
});
test("keeps existing query and hash", () => {
  assert.equal(withImageToken("/api/files/a.png?v=2#x", "T"), "/api/files/a.png?v=2&token=T#x");
  assert.equal(withImageToken("/api/files/a.png#x", "T"), "/api/files/a.png?token=T#x");
});
test("does not add a second token", () => {
  assert.equal(withImageToken("/api/files/a.png?token=old", "T"), "/api/files/a.png?token=old");
  assert.equal(withImageToken("/api/files/a.png?v=1&token=old#h", "T"), "/api/files/a.png?v=1&token=old#h");
});
test("idempotent when applied twice", () => {
  for (const u of ["/api/files/a.png", "/api/files/a.png?v=1", "/api/files/a.png?v=1#h"]) {
    const once = withImageToken(u, "T")!;
    assert.equal(withImageToken(once, "T"), once);
  }
});
test("leaves external, data, protocol-relative and lookalike URLs alone", () => {
  for (const u of [
    "https://cdn.example.com/api/files/a.png", "http://evil.test/api/files/a.png",
    "//evil.test/api/files/a.png", "data:image/png;base64,AAA", "/api/files-evil/a.png",
    "/api/filesx/a.png", "api/files/a.png", "/x/api/files/a.png", "/api/files/../auth/me", "/api/files/%2e%2e/auth/me", "/api/files/%2f..%2fauth", "/api/files\\..\\x",
  ]) assert.equal(withImageToken(u, "T"), u);
});
test("empty values and missing token", () => {
  assert.equal(withImageToken(null, "T"), null);
  assert.equal(withImageToken(undefined, "T"), null);
  assert.equal(withImageToken("", "T"), null);
  assert.equal(withImageToken("/api/files/a.png", ""), "/api/files/a.png");
});
