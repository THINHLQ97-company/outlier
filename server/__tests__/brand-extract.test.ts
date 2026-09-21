// Test cho cơ chế chống bịa của brand profile (nguyên tắc P1, docs/PRD.md §2).
// Đây là logic quan trọng nhất của Brand Profile: model nói gì cũng phải kiểm
// chứng ngược lại tài liệu gốc.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { findQuote, verifyEvidence } from "../services/brand-extract";

const DOC = {
  id: "src-1",
  url: "https://matbao.com/about",
  text: "Mắt Bão cung cấp dịch vụ hosting, tên miền và email doanh nghiệp. " +
        "Chúng tôi phục vụ hơn 100.000 khách hàng là các doanh nghiệp vừa và nhỏ tại Việt Nam.",
};

describe("findQuote — đối chiếu câu trích với tài liệu gốc", () => {
  test("tìm thấy câu trích nguyên văn", () => {
    assert.ok(findQuote(DOC.text, "cung cấp dịch vụ hosting, tên miền") >= 0);
  });

  test("bỏ qua khác biệt hoa thường và khoảng trắng", () => {
    assert.ok(findQuote(DOC.text, "CUNG CẤP   DỊCH VỤ HOSTING") >= 0);
  });

  test("KHÔNG chấp nhận câu model tự viết lại (paraphrase)", () => {
    // Ý đúng nhưng không phải nguyên văn → phải bị từ chối
    assert.equal(findQuote(DOC.text, "Mắt Bão bán hosting và domain cho doanh nghiệp"), -1);
  });

  test("KHÔNG chấp nhận thông tin bịa hoàn toàn", () => {
    assert.equal(findQuote(DOC.text, "Mắt Bão cung cấp dịch vụ cho thuê xe hơi"), -1);
  });

  test("trích quá ngắn bị từ chối (không đủ để kiểm chứng)", () => {
    assert.equal(findQuote(DOC.text, "hosting"), -1);
  });
});

describe("verifyEvidence — lọc evidence không đứng vững", () => {
  test("giữ evidence có thật, kèm sourceId và offset", () => {
    const out = verifyEvidence([{ quote: "hơn 100.000 khách hàng", source_id: "src-1" }], [DOC]);
    assert.equal(out.length, 1);
    assert.equal(out[0].sourceId, "src-1");
    assert.equal(out[0].sourceUrl, "https://matbao.com/about");
    assert.ok(out[0].offset >= 0);
  });

  test("loại bỏ evidence bịa, giữ lại evidence thật", () => {
    const out = verifyEvidence([
      { quote: "doanh nghiệp vừa và nhỏ tại Việt Nam", source_id: "src-1" },
      { quote: "được cấp chứng nhận ISO 9001 năm 2020", source_id: "src-1" }, // bịa
    ], [DOC]);
    assert.equal(out.length, 1);
    assert.ok(out[0].quote.includes("doanh nghiệp vừa và nhỏ"));
  });

  test("tất cả evidence đều bịa → trả mảng rỗng (field sẽ bị bỏ)", () => {
    const out = verifyEvidence([{ quote: "chúng tôi có 50 chi nhánh toàn quốc" }], [DOC]);
    assert.deepEqual(out, []);
  });

  test("model khai sai source_id vẫn tìm được ở tài liệu khác", () => {
    const other = { id: "src-2", text: "Hotline hỗ trợ kỹ thuật hoạt động 24/7 tất cả các ngày." };
    const out = verifyEvidence([{ quote: "hoạt động 24/7 tất cả các ngày", source_id: "src-1" }], [DOC, other]);
    assert.equal(out.length, 1);
    assert.equal(out[0].sourceId, "src-2"); // tự tìm đúng nguồn thật
  });

  test("evidence rỗng / sai kiểu → mảng rỗng, không crash", () => {
    assert.deepEqual(verifyEvidence(undefined, [DOC]), []);
    assert.deepEqual(verifyEvidence([], [DOC]), []);
    assert.deepEqual(verifyEvidence([{ quote: "" }], [DOC]), []);
  });
});
