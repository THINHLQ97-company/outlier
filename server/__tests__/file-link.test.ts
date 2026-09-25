import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileLinkQuery, signedFileUrl, verifyFileLink } from "../services/file-link";

const OLD = process.env.AUTH_SECRET;
before(() => {
  process.env.AUTH_SECRET = "bi-mat-test";
});
after(() => {
  if (OLD) process.env.AUTH_SECRET = OLD;
  else delete process.env.AUTH_SECRET;
});

function parse(q: string) {
  const u = new URLSearchParams(q.replace(/^\?/, ""));
  return { exp: u.get("exp"), sig: u.get("sig") };
}

describe("link file có chữ ký — xem được khi bấm, không mở toang kho ảnh", () => {
  test("link vừa ký thì hợp lệ", () => {
    const { exp, sig } = parse(fileLinkQuery("remakes/abc.jpg"));
    assert.equal(verifyFileLink("remakes/abc.jpg", exp, sig).ok, true);
  });

  test("chữ ký của file NÀY không mở được file KHÁC", () => {
    const { exp, sig } = parse(fileLinkQuery("remakes/abc.jpg"));
    const out = verifyFileLink("remakes/bi-mat-cua-nguoi-khac.jpg", exp, sig);
    assert.equal(out.ok, false);
    assert.match(out.reason || "", /không khớp/);
  });

  test("hết hạn thì nói rõ là hết hạn, khác với sai chữ ký", () => {
    const out = verifyFileLink("k", Math.floor(Date.now() / 1000) - 10, "bat-ky");
    assert.equal(out.ok, false);
    assert.match(out.reason || "", /hết hạn/);
  });

  test("không có chữ ký thì từ chối", () => {
    assert.equal(verifyFileLink("k", undefined, undefined).ok, false);
  });

  test("đổi hạn mà giữ chữ ký cũ thì không qua được", () => {
    const { exp, sig } = parse(fileLinkQuery("k"));
    assert.equal(verifyFileLink("k", Number(exp) + 86400, sig).ok, false);
  });

  test("signedFileUrl ghép thành đường dẫn đầy đủ mở được", () => {
    const url = signedFileUrl("https://outlier.example", "/api/files/remakes/abc.jpg");
    assert.match(url, /^https:\/\/outlier\.example\/api\/files\/remakes\/abc\.jpg\?exp=\d+&sig=/);
  });

  test("link ngoài thì trả nguyên, không cố ký", () => {
    assert.equal(signedFileUrl("https://x", "https://cdn.khac/anh.jpg"), "https://cdn.khac/anh.jpg");
  });
});
