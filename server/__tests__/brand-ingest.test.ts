// Test cho lớp nạp tài liệu brand.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { htmlToText, assertPublicUrl, ingestRawText } from "../services/brand-ingest";
import { findQuote } from "../services/brand-extract";

describe("htmlToText", () => {
  test("lấy được title và bỏ thẻ", () => {
    const { title, text } = htmlToText("<html><head><title>Mắt Bão</title></head><body><p>Chúng tôi bán hosting.</p></body></html>");
    assert.equal(title, "Mắt Bão");
    assert.ok(text.includes("Chúng tôi bán hosting."));
  });

  test("bỏ hẳn script/style, không để lọt code vào text", () => {
    const { text } = htmlToText("<body><script>var x='bí mật';</script><style>.a{color:red}</style><p>Nội dung thật</p></body>");
    assert.ok(!text.includes("bí mật"));
    assert.ok(!text.includes("color:red"));
    assert.ok(text.includes("Nội dung thật"));
  });

  test("KHÔNG làm dính chữ giữa hai khối (quan trọng cho việc khớp câu trích)", () => {
    const { text } = htmlToText("<p>Dịch vụ hosting</p><p>Tên miền giá rẻ</p>");
    assert.ok(!text.includes("hostingTên"), "hai khối bị dính vào nhau");
  });

  test("giải mã HTML entity", () => {
    const { text } = htmlToText("<p>Gi&#225; r&#7867; &amp; ch&#7845;t l&#432;&#7907;ng &ldquo;t&#7889;t&rdquo;</p>");
    assert.ok(text.includes("&") && !text.includes("&amp;"));
    assert.ok(text.includes("“tốt”"));
  });

  test("text trích ra khớp được với findQuote (liên thông với brand-extract)", () => {
    const { text } = htmlToText("<div><h2>Về chúng tôi</h2><p>Mắt Bão phục vụ hơn 100.000 khách hàng doanh nghiệp.</p></div>");
    assert.ok(findQuote(text, "phục vụ hơn 100.000 khách hàng doanh nghiệp") >= 0);
  });
});

describe("assertPublicUrl — chặn SSRF", () => {
  test("cho phép URL công khai", () => {
    assert.equal(assertPublicUrl("https://matbao.com/about").hostname, "matbao.com");
  });

  for (const bad of [
    "http://localhost:3000/admin",
    "http://127.0.0.1/",
    "http://10.0.1.5/secret",
    "http://192.168.1.1/",
    "http://172.16.0.9/",
    "http://169.254.169.254/latest/meta-data/", // metadata cloud
    "http://[::1]/",
    "http://db.internal/",
  ]) {
    test(`chặn ${bad}`, () => {
      assert.throws(() => assertPublicUrl(bad), /nội bộ|hợp lệ/i);
    });
  }

  test("chặn scheme lạ", () => {
    assert.throws(() => assertPublicUrl("file:///etc/passwd"), /http/i);
    assert.throws(() => assertPublicUrl("gopher://x/"), /http/i);
  });

  test("chặn link rác", () => {
    assert.throws(() => assertPublicUrl("không phải link"), /không hợp lệ/i);
  });
});

describe("ingestRawText", () => {
  test("từ chối nội dung quá ngắn", () => {
    assert.throws(() => ingestRawText("ngắn quá"), /quá ngắn/i);
  });

  test("giữ nguyên văn nội dung dán tay", () => {
    const src = "Mắt Bão là nhà cung cấp dịch vụ hosting và tên miền hàng đầu Việt Nam từ năm 2005.";
    assert.equal(ingestRawText(src).text, src);
  });
});
