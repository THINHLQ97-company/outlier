import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import type { AddressInfo } from "net";
import type { Server } from "http";

// Chạy THẬT endpoint /api/mcp-signals qua HTTP (không grep mã nguồn): đúng thứ
// Claude Chat nhận được ở initialize / tools/list / access_check. Sinh ra sau
// vụ 2026-11-04: Claude Chat báo trend_submit_research thiếu decision/pageAngles
// trong khi mã nguồn có — cần bằng chứng server serialize đủ trường, và một
// version đổi theo schema để phân biệt server cũ với client giữ schema cũ.
//
// DATABASE_URL chỉ cần có mặt để qua cổng isDbConfigured(); pool pg tạo lười và
// ba method dưới đây không truy vấn DB nên không mở kết nối nào.
const TOKEN = `test-${crypto.randomUUID()}`;
const saved = { db: process.env.DATABASE_URL, tok: process.env.SIGNALS_MCP_TOKEN };
let server: Server;
let base = "";

async function rpc(method: string, params?: any, auth = `Bearer ${TOKEN}`) {
  const res = await fetch(`${base}/api/mcp-signals`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }),
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
}

const EDITORIAL = ["decision", "rationale", "pageAngles", "sources", "avoid"];

describe("MCP phục vụ đúng schema qua HTTP", () => {
  before(async () => {
    process.env.DATABASE_URL = "postgres://unused:unused@127.0.0.1:1/unused";
    process.env.SIGNALS_MCP_TOKEN = TOKEN;
    const express = (await import("express")).default;
    const { registerMcpSignalsRoutes } = await import("../routes/mcp-signals.routes");
    const app = express();
    app.use(express.json());
    registerMcpSignalsRoutes(app);
    server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise((r) => server.close(r));
    if (saved.db === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = saved.db;
    if (saved.tok === undefined) delete process.env.SIGNALS_MCP_TOKEN; else process.env.SIGNALS_MCP_TOKEN = saved.tok;
  });

  test("không token thì tools/list bị chặn 401", async () => {
    const r = await rpc("tools/list", undefined, "");
    assert.equal(r.status, 401);
  });

  test("tools/list: trend_submit_research có đủ trường biên tập, giống trend_discover", async () => {
    const r = await rpc("tools/list");
    assert.equal(r.status, 200);
    const tools: any[] = r.body.result.tools;
    const props = (n: string) => Object.keys(tools.find((t) => t.name === n)?.inputSchema?.properties || {});
    const submit = props("trend_submit_research");
    const discover = props("trend_discover");
    for (const f of EDITORIAL) {
      assert.ok(submit.includes(f), `trend_submit_research thiếu ${f} trong tools/list`);
      assert.ok(discover.includes(f), `trend_discover thiếu ${f} trong tools/list`);
    }
    assert.deepEqual(tools.find((t) => t.name === "trend_submit_research").inputSchema.properties.decision.enum, ["pursue", "watch", "skip"]);
    // Ngoài trường riêng (item_id vs title/keyword), hai tool phải cùng bộ trường nghiên cứu.
    const shared = (xs: string[]) => xs.filter((x) => !["item_id", "title", "keyword"].includes(x)).sort();
    assert.deepEqual(shared(submit), shared(discover));
  });

  test("initialize: version gắn với dấu vân tay của đúng mảng tools trả ra", async () => {
    const init = await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } });
    const info = init.body.result.serverInfo;
    assert.equal(info.name, "fanpage-signals", "đổi name làm client đã lưu phải nối lại");
    assert.match(info.version, /^\d+\.\d+\.\d+\+[0-9a-f]{12}$/);
    assert.notEqual(info.version, "2.0.0");
    // Không khai listChanged khi chưa thật sự gửi notifications/tools/list_changed.
    assert.equal(init.body.result.capabilities.tools.listChanged, undefined);

    const list = await rpc("tools/list");
    const fp = crypto.createHash("sha256").update(JSON.stringify(list.body.result.tools)).digest("hex").slice(0, 12);
    assert.ok(info.version.endsWith(`+${fp}`), "dấu vân tay phải tính từ chính payload tools/list");
  });

  test("access_check trả mcp_schema khớp tools/list, không lộ cấu hình", async () => {
    const r = await rpc("tools/call", { name: "access_check", arguments: {} });
    assert.equal(r.status, 200);
    assert.notEqual(r.body.result.isError, true);
    const text: string = r.body.result.content[0].text;
    assert.ok(!text.includes(TOKEN), "token không được xuất hiện trong output");
    assert.ok(!text.includes("postgres://"), "DATABASE_URL không được xuất hiện trong output");
    const out = JSON.parse(text);
    const init = await rpc("initialize", {});
    assert.equal(out.mcp_schema.server_version, init.body.result.serverInfo.version);
    const list = await rpc("tools/list");
    assert.equal(out.mcp_schema.tool_count, list.body.result.tools.length);
    const served = list.body.result.tools.find((t: any) => t.name === "trend_submit_research");
    assert.deepEqual(out.mcp_schema.trend_tool_inputs.trend_submit_research.properties, Object.keys(served.inputSchema.properties));
    assert.deepEqual(out.mcp_schema.trend_tool_inputs.trend_submit_research.required, served.inputSchema.required);
  });

  test("build_id chỉ nhận chuỗi dạng mã commit, giá trị lạ thành null", async () => {
    const { mcpSchemaDiagnostics } = await import("../routes/mcp-signals.routes");
    const prev = process.env.SOURCE_COMMIT;
    const prevOutlier = process.env.OUTLIER_BUILD_ID;
    delete process.env.OUTLIER_BUILD_ID;
    try {
      process.env.SOURCE_COMMIT = "c172c1cc8b60";
      assert.equal(mcpSchemaDiagnostics().build_id, "c172c1cc8b60");
      process.env.SOURCE_COMMIT = "postgres://user:pass@host/db";
      assert.equal(mcpSchemaDiagnostics().build_id, null);
    } finally {
      if (prev === undefined) delete process.env.SOURCE_COMMIT; else process.env.SOURCE_COMMIT = prev;
      if (prevOutlier !== undefined) process.env.OUTLIER_BUILD_ID = prevOutlier;
    }
  });
});
