// Xuất kết quả ra CSV cho team dùng tiếp (docs/PRD.md §4 J6).
//
// Hai điểm dễ sai mà ở đây xử lý sẵn:
//  1. BOM UTF-8 — thiếu nó Excel mở ra tiếng Việt thành ký tự rác.
//  2. Ô bắt đầu bằng = + - @ bị Excel hiểu là công thức. Nội dung do người ngoài
//     viết (tiêu đề bài gốc) có thể lợi dụng chuyện này, nên chèn dấu nháy đơn.
export const UTF8_BOM = "﻿";

/** Bọc một ô cho đúng chuẩn CSV, chống cả lỗi Excel hiểu nhầm công thức. */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  // Excel coi ô mở đầu bằng = + - @ là công thức → vô hiệu hoá.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  // Luôn bọc ngoặc kép cho an toàn; nhân đôi ngoặc kép bên trong.
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvCell).join(",")];
  for (const r of rows) lines.push(r.map(csvCell).join(","));
  // CRLF để Excel trên Windows xuống dòng đúng.
  return UTF8_BOM + lines.join("\r\n") + "\r\n";
}

/** Tên file an toàn: bỏ ký tự không hợp lệ, tránh tên rỗng. */
export function safeFilename(base: string, ext = "csv"): string {
  const clean = base.normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9-_ ]/g, "").trim().replace(/\s+/g, "-").slice(0, 60);
  const stamp = new Date().toISOString().slice(0, 10);
  return `${clean || "outlier"}-${stamp}.${ext}`;
}

/** Gộp các vấn đề guardrail thành một ô đọc được. */
export function guardrailSummary(g: any): { status: string; issues: string } {
  if (!g) return { status: "Chưa kiểm tra", issues: "" };
  const blocks = (g.issues || []).filter((i: any) => i.severity === "block");
  const warns = (g.issues || []).filter((i: any) => i.severity === "warn");
  const status = g.passed
    ? warns.length ? `Đạt (${warns.length} điểm nên xem lại)` : "Đạt"
    : `Còn ${blocks.length} lỗi phải sửa`;
  const issues = (g.issues || []).map((i: any) => `[${i.severity === "block" ? "Phải sửa" : "Nên xem"}] ${i.message}`).join(" | ");
  return { status, issues };
}
