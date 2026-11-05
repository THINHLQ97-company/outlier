import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mockDb } from "./helpers/trend-mock-db";
import { normalizeSettings } from "../services/trend-workflow-settings";
import { registerTrendWorkflowRoutes } from "../routes/trend-workflow.routes";
import { drainTrendOutbox } from "../services/trend-teams";
import { rssBrief } from "../services/trend-research";

// Mock DB + mock POST only: never reaches a real Teams webhook.
const ID = "2d2da423-0006-4f2c-aad0-d6f713dc38ec";
const brief = (o: any = {}) => ({ ...rssBrief({ title: "Bông hoa chưa nở", news: [] }), decision: "pursue", decisionRationale: "test", ...o });
const settings = normalizeSettings({ enabled: true, teamsEnabled: false, publicBaseUrl: "https://outlier.example.com" });
function setup(o: { item?: any; dryRun?: boolean; drafts?: any[]; webhook?: string | null; post?: any } = {}) {
  const { db, tables } = mockDb({
    trend_workflow_runs: [{ id: "run", slot: "s", dryRun: Boolean(o.dryRun), status: "done", createdAt: new Date() }],
    trend_workflow_items: [{ id: ID, runId: "run", inputKey: "k", title: "Bông hoa chưa nở", input: {}, brief: brief(), status: "error", deletedAt: null, createdAt: new Date(), ...o.item }],
    trend_workflow_drafts: o.drafts || [], trend_teams_outbox: [],
  });
  const posts: any[] = [];
  const post = o.post || (async (_url: string, init: any) => { posts.push(JSON.parse(init.body)); return { status: 202 }; });
  const app = express();
  const pass: any = (_q: any, _s: any, next: any) => next();
  registerTrendWorkflowRoutes(app, { configured: () => true, db: () => db as any, auth: pass, guard: async () => null,
    webhook: async () => o.webhook === undefined ? "https://prod.api.powerplatform.com/mock" : o.webhook, settings: async () => settings,
    drain: id => drainTrendOutbox(post, id, { db: () => db, settings: async () => settings, webhook: async () => "https://prod.api.powerplatform.com/mock" }) });
  return { app, tables, posts };
}
// Skip requireAuth/requireTrendOwner (owner-only 403 is covered in trend-workflow-owner.test.ts); call the handler.
async function send(app: any, body: any = { confirm: true }) {
  const layer = app._router.stack.find((r: any) => r.route?.path === "/api/trend-workflow/trends/:id/send" && r.route.methods.post);
  const out: any = { status: 200 };
  const res: any = { status(n: number) { out.status = n; return res; }, json(x: any) { out.body = x; return res; } };
  await layer.route.stack.at(-1).handle({ body, params: { id: ID }, headers: {} }, res);
  return out;
}

test("gửi tay khi chưa có bản nháp: Teams nhận, cảnh báo chỉ có nút xem chi tiết", async () => {
  const { app, tables, posts } = setup();
  const r = await send(app);
  assert.equal(r.status, 200); assert.equal(r.body.status, "accepted");
  assert.match(r.body.warning, /Chưa có bản nháp; thẻ chỉ có nút xem chi tiết/);
  assert.match(r.body.message, /chưa xác nhận đã hiển thị/);
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].attachments[0].content.actions.map((a: any) => a.title), ["Xem chi tiết trên Outlier"]);
  assert.match(tables.trend_teams_outbox[0].idempotencyKey, new RegExp(`^manual:${ID}:`));
});

test("có bản nháp ready thì thẻ có nút mở bản nháp, không cảnh báo; thẻ tự động cũ không chặn", async () => {
  const { app, tables, posts } = setup({ drafts: [{ id: "d", itemId: ID, remakeId: "11111111-1111-4111-8111-111111111111", pageName: "Gàn và Gèn", angle: "a", status: "ready", error: "Ý tưởng ảnh lỗi: x" }] });
  tables.trend_teams_outbox.push({ id: "auto", idempotencyKey: `trend-item:${ID}`, itemId: ID, status: "accepted", createdAt: new Date(), acceptedAt: new Date(), attempts: 1, payload: {} });
  const r = await send(app);
  assert.equal(r.status, 200); assert.equal(r.body.warning, null);
  assert.ok(posts[0].attachments[0].content.actions.some((a: any) => /remakeId=/.test(a.url)));
});

test("bấm trùng trong 2 phút chỉ gửi một lần", async () => {
  const { app, posts } = setup();
  assert.equal((await send(app)).status, 200);
  const again = await send(app);
  assert.equal(again.status, 409); assert.equal(again.body.code, "RECENTLY_SENT"); assert.equal(again.body.status, "accepted");
  assert.equal(posts.length, 1);
});

test("điều kiện chặn: chưa xác nhận, chạy thử, chưa chọn đu, nhạy cảm, chưa có webhook", async () => {
  const cases: [any, string][] = [
    [{}, "CONFIRM_REQUIRED"],
    [{ dryRun: true }, "DRY_RUN_ONLY"],
    [{ item: { brief: brief({ decision: "watch" }) } }, "DECISION_REQUIRED"],
    [{ item: { brief: brief({ sensitive: true }) } }, "SENSITIVE_TREND"],
    [{ item: { status: "excluded" } }, "SENSITIVE_TREND"],
    [{ webhook: null }, "WEBHOOK_NOT_CONFIGURED"],
    [{ item: { brief: null } }, "BRIEF_NOT_FOUND"],
  ];
  for (const [o, code] of cases) {
    const { app, posts, tables } = setup(o);
    const r = await send(app, code === "CONFIRM_REQUIRED" ? {} : { confirm: true });
    assert.equal(r.body.code, code, code); assert.ok(r.status >= 400);
    assert.equal(posts.length, 0); assert.equal(tables.trend_teams_outbox.length, 0);
  }
});

test("lỗi mạng trả unknown thật, không báo đã nhận", async () => {
  const { app } = setup({ post: async () => { throw new Error("timeout"); } });
  const r = await send(app);
  assert.equal(r.body.status, "unknown"); assert.match(r.body.message, /Chưa rõ/);
});
