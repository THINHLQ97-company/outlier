import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import express from "express";
import { PgDialect } from "drizzle-orm/pg-core";
import { registerTrendWorkflowRoutes } from "../routes/trend-workflow.routes";

process.env.AUTH_SECRET ||= "test-secret-for-trend-owner-0123456789";
const dialect = new PgDialect();
const token = (username: string) => {
  const payload = JSON.stringify({ username, ts: Date.now() });
  return `${Buffer.from(payload).toString("base64")}.${crypto.createHmac("sha256", process.env.AUTH_SECRET!).update(payload).digest("hex")}`;
};
const OWNER = "lamquangthinh3006@gmail.com";
const user = (o: any) => ({ username: "u", role: "admin", isActive: true, email: OWNER, ...o });
function setup(rows: any[]) {
  const db: any = { select: () => ({ from: () => {
    let list: any[] = [];
    const q: any = { where(p: any) { const name = dialect.sqlToQuery(p).params[0]; list = rows.filter(r => r.username === name); return q; }, orderBy: () => q, limit: () => q, then: (r: any, j: any) => Promise.resolve(list).then(r, j) };
    return q;
  } }) };
  const app = express();
  const auth: any = (_q: any, _s: any, next: any) => next();
  registerTrendWorkflowRoutes(app, { configured: () => true, db: () => db, auth, queue: async () => ({ runId: "r", status: "pending" }) });
  return app;
}
// Chạy toàn bộ chuỗi middleware; "reached" = tới handler cuối (kết quả sau đó không quan trọng).
async function call(app: any, method: string, path: string, username: string, body: any = {}) {
  const layer = app._router.stack.find((r: any) => r.route?.path === path && r.route.methods[method]);
  const result: any = {}; let reached = false;
  const res: any = { status(n: number) { result.status = n; return res; }, json(x: any) { result.body = x; return res; } };
  const req: any = { body, params: { id: "x" }, headers: { authorization: `Bearer ${token(username)}` }, query: {} };
  const stack = layer.route.stack;
  for (let i = 0; i < stack.length; i++) {
    let advanced = false;
    if (i === stack.length - 1) reached = true;
    await stack[i].handle(req, res, () => { advanced = true; });
    if (!advanced) break;
  }
  return { ...result, reached };
}
const guarded: [string, string][] = [["put", "/api/trend-workflow/settings"], ["get", "/api/trend-workflow/settings"], ["post", "/api/trend-workflow/run"], ["post", "/api/trend-workflow/trends/:id/send-test"], ["post", "/api/trend-workflow/outbox/:id/resolve"]];
const withEnv = async (v: string | undefined, fn: () => Promise<void>) => {
  const old = process.env.TREND_WORKFLOW_ADMIN_EMAILS;
  if (v === undefined) delete process.env.TREND_WORKFLOW_ADMIN_EMAILS; else process.env.TREND_WORKFLOW_ADMIN_EMAILS = v;
  try { await fn(); } finally { if (old === undefined) delete process.env.TREND_WORKFLOW_ADMIN_EMAILS; else process.env.TREND_WORKFLOW_ADMIN_EMAILS = old; }
};

test("admin khác email bị 403 ở mọi endpoint ghi/điều khiển và GET settings", () => withEnv(undefined, async () => {
  const app = setup([user({ email: "other@matbao.com" })]);
  for (const [m, p] of guarded) { const r = await call(app, m, p, "u"); assert.equal(r.status, 403, p); assert.equal(r.reached, false); }
}));
test("đúng email + admin + active được qua middleware", () => withEnv(undefined, async () => {
  const app = setup([user({})]);
  for (const [m, p] of guarded) assert.equal((await call(app, m, p, "u")).reached, true, p);
}));
test("đúng email nhưng không phải admin hoặc không active bị 403", () => withEnv(undefined, async () => {
  for (const o of [{ role: "member" }, { isActive: false }]) {
    const app = setup([user(o)]);
    for (const [m, p] of guarded) assert.equal((await call(app, m, p, "u")).status, 403);
  }
}));
test("so khớp email không phân biệt hoa thường và khoảng trắng", () => withEnv(undefined, async () => {
  const app = setup([user({ email: `  LamQuangThinh3006@Gmail.COM ` })]);
  assert.equal((await call(app, "post", "/api/trend-workflow/run", "u")).reached, true);
}));
test("env danh sách nhiều email; env đặt thì email mặc định không còn hiệu lực", () => withEnv(" a@x.com , B@X.com ", async () => {
  const app = setup([user({ username: "a", email: "a@x.com" }), user({ username: "b", email: "b@x.com" }), user({ username: "d", email: OWNER })]);
  assert.equal((await call(app, "post", "/api/trend-workflow/run", "a")).reached, true);
  assert.equal((await call(app, "post", "/api/trend-workflow/run", "b")).reached, true);
  assert.equal((await call(app, "post", "/api/trend-workflow/run", "d")).status, 403);
}));
test("username trùng chuỗi email nhưng email khác, hoặc không có email -> 403", () => withEnv(undefined, async () => {
  const app = setup([user({ username: OWNER, email: "x@y.com" }), user({ username: "noemail", email: null })]);
  assert.equal((await call(app, "post", "/api/trend-workflow/run", OWNER)).status, 403);
  assert.equal((await call(app, "post", "/api/trend-workflow/run", "noemail")).status, 403);
}));
test("người thường vẫn xem được danh sách trend (không qua kiểm quyền)", () => withEnv(undefined, async () => {
  const app = setup([user({ role: "member", email: "m@x.com" })]);
  const r = await call(app, "get", "/api/trend-workflow/trends", "u");
  assert.equal(r.status, undefined); assert.deepEqual(r.body, { items: [] });
}));
