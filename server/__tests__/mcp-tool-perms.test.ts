import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";

// Đọc mã nguồn thay vì import: mcp-signals.routes.ts nối vào Express và kéo theo
// cả DB, nặng và không cần cho việc kiểm hai danh sách có khớp nhau.
//
// Vì sao đáng một test riêng: tool đọc mà xếp vào nhóm ghi thì bị chặn vô cớ, và
// người dùng chỉ thấy "gọi tool không ra kết quả" — không ai đoán ra là phân
// loại lệch. Hai tool đầu tiên đã vấp đúng lỗi này (styles_list,
// style_brand_material).
const src = fs.readFileSync(
  path.join(process.cwd(), "server", "routes", "mcp-signals.routes.ts"),
  "utf8",
);

const readonlySet = new Set(
  (src.match(/const READONLY_TOOLS = new Set\(\[([\s\S]*?)\]\)/)?.[1] || "")
    .split(",")
    .map((x) => x.replace(/["\s]/g, ""))
    .filter(Boolean),
);

const declared = [
  ...src.matchAll(
    /name: "([a-z_]+)",\s*\n\s*description:[\s\S]*?readOnlyHint: (true|false)/g,
  ),
].map(([, name, hint]) => ({ name, readOnly: hint === "true" }));

describe("MCP — nhóm quyền phải khớp readOnlyHint đã khai", () => {
  test("đọc được danh sách tool và danh sách chỉ-đọc từ mã nguồn", () => {
    assert.ok(declared.length > 30, `chỉ thấy ${declared.length} tool — regex hỏng?`);
    assert.ok(readonlySet.size > 10, `chỉ thấy ${readonlySet.size} tool chỉ đọc`);
  });

  test("tool khai readOnlyHint:true đều nằm trong READONLY_TOOLS", () => {
    const missing = declared.filter((t) => t.readOnly && !readonlySet.has(t.name)).map((t) => t.name);
    assert.deepEqual(missing, [], `tool đọc bị đòi quyền ghi: ${missing.join(", ")}`);
  });

  test("không tool ghi nào lọt vào READONLY_TOOLS", () => {
    const leaked = declared.filter((t) => !t.readOnly && readonlySet.has(t.name)).map((t) => t.name);
    assert.deepEqual(leaked, [], `tool ghi được cho qua không cần quyền: ${leaked.join(", ")}`);
  });

  test("mọi tên trong READONLY_TOOLS đều là tool có thật", () => {
    const names = new Set(declared.map((t) => t.name));
    const ghosts = [...readonlySet].filter((n) => !names.has(n));
    assert.deepEqual(ghosts, [], `tên không ứng với tool nào: ${ghosts.join(", ")}`);
  });

  test("access_check là tool đọc — phải gọi được cả khi tài khoản không có quyền ghi", () => {
    assert.ok(readonlySet.has("access_check"), "không thì đúng lúc cần soi quyền lại bị chặn");
  });

  test("lỗi thiếu quyền trả dạng isError, không phải lỗi tầng giao thức", () => {
    // rpcError bị client coi là sự cố kết nối và thường không hiện ra, nên người
    // dùng chỉ thấy tool im lặng.
    assert.doesNotMatch(src, /rpcError\(id, -32000, "Cần quyền/);
    assert.match(src, /missing_permission: "signals-edit"/);
  });
});
