// Test xuất CSV — tập trung vào hai lỗi hay gặp: tiếng Việt bị hỏng trong Excel,
// và ô bị Excel hiểu nhầm là công thức.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { csvCell, toCsv, safeFilename, guardrailSummary, UTF8_BOM } from "../services/export-csv";

describe("csvCell", () => {
  test("bọc ngoặc kép", () => {
    assert.equal(csvCell("xin chào"), '"xin chào"');
  });
  test("nhân đôi ngoặc kép bên trong", () => {
    assert.equal(csvCell('anh ấy nói "được"'), '"anh ấy nói ""được"""');
  });
  test("giữ nguyên dấu phẩy và xuống dòng trong ô", () => {
    const c = csvCell("dòng 1\ndòng 2, còn nữa");
    assert.ok(c.includes("\n") && c.includes(","));
  });
  test("vô hiệu hoá ô bị Excel hiểu là công thức", () => {
    for (const bad of ["=1+1", "+84912345678", "-5", "@SUM(A1)"]) {
      assert.ok(csvCell(bad).startsWith(`"'`), `chưa chặn: ${bad}`);
    }
  });
  test("số điện thoại dạng +84 không mất dấu cộng", () => {
    assert.ok(csvCell("+84912345678").includes("+84912345678"));
  });
  test("rỗng/null → ô trống", () => {
    assert.equal(csvCell(null), "");
    assert.equal(csvCell(undefined), "");
  });
});

describe("toCsv", () => {
  test("có BOM để Excel đọc đúng tiếng Việt", () => {
    assert.ok(toCsv(["Tiêu đề"], [["Nội dung tiếng Việt có dấu"]]).startsWith(UTF8_BOM));
  });
  test("dùng CRLF", () => {
    assert.ok(toCsv(["a"], [["b"]]).includes("\r\n"));
  });
  test("số cột khớp header", () => {
    const csv = toCsv(["A", "B"], [["1", "2"], ["3", "4"]]);
    const lines = csv.replace(UTF8_BOM, "").trim().split("\r\n");
    assert.equal(lines.length, 3);
    assert.equal(lines[0], '"A","B"');
  });
});

describe("safeFilename", () => {
  test("bỏ dấu tiếng Việt và ký tự lạ", () => {
    const f = safeFilename("Bản viết / Mắt Bão *2026*");
    assert.ok(!/[\/\*]/.test(f), f);
    assert.ok(f.endsWith(".csv"));
  });
  test("tên rỗng vẫn ra file hợp lệ", () => {
    assert.ok(safeFilename("###").startsWith("outlier-"));
  });
  test("có ngày tháng để phân biệt các lần xuất", () => {
    assert.match(safeFilename("abc"), /\d{4}-\d{2}-\d{2}\.csv$/);
  });
});

describe("guardrailSummary", () => {
  test("chưa kiểm tra", () => {
    assert.equal(guardrailSummary(null).status, "Chưa kiểm tra");
  });
  test("đạt, không cảnh báo", () => {
    assert.equal(guardrailSummary({ passed: true, issues: [] }).status, "Đạt");
  });
  test("đạt nhưng có nhắc nhở", () => {
    const r = guardrailSummary({ passed: true, issues: [{ severity: "warn", message: "xưng hô" }] });
    assert.match(r.status, /nên xem lại/);
  });
  test("còn lỗi chặn → nói rõ số lượng", () => {
    const r = guardrailSummary({ passed: false, issues: [
      { severity: "block", message: "trùng bài gốc" },
      { severity: "block", message: "từ cấm" },
    ]});
    assert.match(r.status, /2 lỗi/);
    assert.ok(r.issues.includes("Phải sửa"));
  });
});
