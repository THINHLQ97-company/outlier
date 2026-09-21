// Test cho giới hạn domain đăng nhập Google.
// Chạy: npm test
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { domainAllowed } from "../services/google-user";

const ORIGINAL = process.env.GOOGLE_ALLOWED_DOMAINS;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.GOOGLE_ALLOWED_DOMAINS;
  else process.env.GOOGLE_ALLOWED_DOMAINS = ORIGINAL;
});

describe("domainAllowed", () => {
  test("mặc định chỉ cho phép matbao.com", () => {
    delete process.env.GOOGLE_ALLOWED_DOMAINS;
    assert.equal(domainAllowed("thinhlq@matbao.com"), true);
    assert.equal(domainAllowed("ai@gmail.com"), false);
  });

  test("không nhầm domain chứa chuỗi con", () => {
    delete process.env.GOOGLE_ALLOWED_DOMAINS;
    // "notmatbao.com" và "matbao.com.evil.tld" phải bị từ chối
    assert.equal(domainAllowed("x@notmatbao.com"), false);
    assert.equal(domainAllowed("x@matbao.com.evil.tld"), false);
  });

  test("không phân biệt hoa thường", () => {
    delete process.env.GOOGLE_ALLOWED_DOMAINS;
    assert.equal(domainAllowed("Thinh@MatBao.COM"), true);
  });

  test("nhiều domain ngăn cách bằng dấu phẩy", () => {
    process.env.GOOGLE_ALLOWED_DOMAINS = "matbao.com, doitac.vn";
    assert.equal(domainAllowed("a@matbao.com"), true);
    assert.equal(domainAllowed("b@doitac.vn"), true);
    assert.equal(domainAllowed("c@khac.com"), false);
  });

  test('"*" tắt kiểm tra', () => {
    process.env.GOOGLE_ALLOWED_DOMAINS = "*";
    assert.equal(domainAllowed("ai@bat-ky-dau.com"), true);
  });

  test("email dị dạng bị từ chối", () => {
    delete process.env.GOOGLE_ALLOWED_DOMAINS;
    assert.equal(domainAllowed("khong-co-a-cong"), false);
    assert.equal(domainAllowed(""), false);
  });

  test("email nhiều dấu @ lấy đúng domain cuối", () => {
    delete process.env.GOOGLE_ALLOWED_DOMAINS;
    assert.equal(domainAllowed('"a@b"@matbao.com'), true);
    assert.equal(domainAllowed('"a@matbao.com"@evil.com'), false);
  });
});
