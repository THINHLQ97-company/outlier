import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import crypto from "crypto";
import path from "path";
import { mockDb } from "./helpers/trend-mock-db";
import { normalizeSettings } from "../services/trend-workflow-settings";
import { refreshTrends, runTrendWorkflow } from "../services/trend-workflow";
import { discoverTrend, trendResearchQueue, trendResearchStatus } from "../services/trend-claude";
import { drainTrendOutbox } from "../services/trend-teams";
import { cleanupTrends, restoreTrends, trashTrends } from "../services/trend-trash";
import { registerTrendWorkflowRoutes } from "../routes/trend-workflow.routes";
import { rssBrief } from "../services/trend-research";

// Mock DB only: no socket, no Teams, no model, no Apify.
const config = normalizeSettings({ enabled: true, researchProvider: "claude_mcp", maxTrends: 3 });
const now = new Date("2026-11-04T10:00:00Z");
const day = 86400_000;
const id = (n: number) => `00000000-0000-4000-8000-${String(900 + n).padStart(12, "0")}`;
const RUN = "00000000-0000-4000-8000-000000000999";
const item = (n: number, o: any = {}) => ({ id: id(n), runId: RUN, inputKey: `trend ${n}`, title: `Trend ${n}`, input: { title: `Trend ${n}`, news: [] }, status: "awaiting_research", checkpoint: "awaiting_research", attempts: 0, brief: null, deletedAt: null, createdAt: now, updatedAt: now, ...o });
process.env.AUTH_SECRET ||= "test-secret-for-trend-owner-0123456789";
const token = (username: string) => { const payload = JSON.stringify({ username, ts: Date.now() }); return `${Buffer.from(payload).toString("base64")}.${crypto.createHmac("sha256", process.env.AUTH_SECRET!).update(payload).digest("hex")}`; };
const run = { id: RUN, slot: "s", dryRun: false, status: "partial", modelCalls: 0, maxModelCalls: 5, createdAt: now };

test("xoá mềm: ẩn khỏi danh sách mặc định, trend_queue, trend_status; Thùng rác thấy; khôi phục được", async () => {
  const { db, tables } = mockDb({ trend_workflow_runs: [{ ...run }], trend_workflow_items: [item(1), item(2)], trend_workflow_drafts: [{ id: "d", itemId: id(1), remakeId: "r1", status: "ready" }] });
  assert.equal(await trashTrends([id(1)], "owner", db), 1);
  assert.equal(await trashTrends([id(1)], "owner", db), 0); // idempotent
  const row = tables.trend_workflow_items[0];
  assert.equal(row.deleteReason, "manual"); assert.equal(row.deletedBy, "owner"); assert.ok(row.deletedAt);
  assert.deepEqual((await trendResearchQueue(db, config)).items.map(i => i.itemId), [id(2)]);
  await assert.rejects(trendResearchStatus(id(1), db), /Không tìm thấy/);
  // Draft and remake untouched.
  assert.equal(tables.trend_workflow_drafts.length, 1);
  assert.equal(await restoreTrends([id(1)], db), 1);
  assert.equal(row.deletedAt, null); assert.equal(row.deleteReason, null);
  assert.equal((await trendResearchQueue(db, config)).items.length, 2);
});

test("route: danh sách mặc định bỏ item đã xoá; ?trash=1 chỉ trả item đã xoá", async () => {
  const { db } = mockDb({ trend_workflow_items: [item(1, { deletedAt: now, deleteReason: "manual" }), item(2)], trend_workflow_drafts: [],
    users: [{ username: "u", role: "admin", isActive: true, email: "lamquangthinh3006@gmail.com" }] });
  const app: any = { get: (p: string, ...h: any[]) => routes.push({ m: "get", p, h }), post: (p: string, ...h: any[]) => routes.push({ m: "post", p, h }), put: () => {} };
  const routes: any[] = [];
  const pass: any = (_q: any, _s: any, next: any) => next();
  registerTrendWorkflowRoutes(app, { configured: () => true, db: () => db, auth: pass });
  const handler = routes.find(r => r.m === "get" && r.p === "/api/trend-workflow/trends").h.at(-1);
  const call = async (query: any) => { const out: any = {}; const res: any = { status(n: number) { out.status = n; return res; }, json(x: any) { out.body = x; return res; } };
    await handler({ query, headers: { authorization: `Bearer ${token("u")}` } }, res); return out; };
  const list = await call({});
  assert.deepEqual(list.body.items.map((i: any) => i.id), [id(2)]);
  assert.deepEqual([list.body.total, list.body.trashTotal], [1, 1]);
  const trash = await call({ trash: "1" });
  assert.deepEqual(trash.body.items.map((i: any) => [i.id, i.deleteReason]), [[id(1), "manual"]]);
});

test("dedupe 48 giờ của trend_refresh và trend_discover vẫn tính item đã xoá", async () => {
  const { db, tables } = mockDb();
  await refreshTrends({ db, config, now, cooldownMs: 0, trends: async () => [{ title: "Giá vàng", news: [] } as any] });
  assert.equal(tables.trend_workflow_items.length, 1);
  await trashTrends([tables.trend_workflow_items[0].id], "owner", db);
  const again = await refreshTrends({ db, config, now: new Date(now.getTime() + 60_000), cooldownMs: 0, trends: async () => [{ title: "Giá vàng", news: [] } as any] });
  assert.equal(again.created, 0); assert.equal(tables.trend_workflow_items.length, 1);
  const out: any = await discoverTrend({ title: "Giá vàng", summary: "s", claims: [{ text: "c", urls: ["https://news.example.com/a"] }], decision: "watch" }, "claude", db, config);
  assert.equal(out.status, "duplicate");
});

test("worker không xử lý item đã xoá: không research/Apify/nháp", async () => {
  const brief = { ...rssBrief({ title: "Trend 1", news: [] } as any), decision: "pursue", decisionRationale: "x" };
  const { db, tables } = mockDb({ trend_workflow_runs: [{ ...run }], trend_workflow_items: [item(1, { status: "researched", brief, deletedAt: now, deleteReason: "manual" })] });
  let calls = 0;
  const deps: any = { trends: async () => { calls++; return []; }, research: async () => { calls++; return brief; }, structure: async () => { calls++; return {}; }, write: async () => { calls++; return {}; }, facebook: { run: async () => { calls++; } } };
  await runTrendWorkflow({ db, config: { ...config, researchProvider: "gemini" }, reason: "test", now: new Date("2026-11-04T03:00:00Z"), deps, queuedRunId: RUN });
  assert.equal(calls, 0);
  assert.equal(tables.trend_workflow_items[0].attempts, 0);
  assert.equal(tables.trend_workflow_items[0].status, "researched");
  assert.equal((tables.remakes || []).length, 0);
});

test("item bị xoá giữa chừng: hàng rào trong transaction chặn ghi bản nháp", async () => {
  const brief = { ...rssBrief({ title: "Trend 1", news: [] } as any), decision: "pursue", decisionRationale: "x" };
  const { db, tables } = mockDb({ trend_workflow_runs: [{ ...run }], trend_workflow_items: [item(1, { status: "researched", brief })], deconstructions: [], brands: [{ id: "b" }], brand_fanpages: [{ id: "p", brandId: "b" }] });
  const deps: any = { structure: async () => { await trashTrends([id(1)], "owner", db); return { structure: { formula: "f" } }; }, write: async () => ({ draft: "x" }), concepts: async () => {}, pageCharacters: async () => [] };
  await runTrendWorkflow({ db, config: { ...config, researchProvider: "gemini", targets: [{ brandId: "b", fanpageId: "p" }] }, reason: "test", now: new Date("2026-11-04T03:00:00Z"), deps, queuedRunId: RUN });
  assert.equal((tables.deconstructions || []).length, 0);
  assert.equal((tables.remakes || []).length, 0);
  assert.equal((tables.trend_teams_outbox || []).length, 0);
  assert.equal(tables.trend_workflow_items[0].status, "researched"); // not marked error
});

test("outbox chưa gửi của item đã xoá bị huỷ (không xoá dòng), không gọi Teams", async () => {
  const { db, tables } = mockDb({ trend_workflow_items: [item(1), item(2)], trend_teams_outbox: [
    { id: "a", itemId: id(1), status: "pending", attempts: 0, nextAttemptAt: new Date(0), payload: {} },
    { id: "b", itemId: id(2), status: "retry", attempts: 1, nextAttemptAt: new Date(0), payload: {} },
    { id: "c", itemId: id(1), status: "accepted", attempts: 1, nextAttemptAt: new Date(0), payload: {} }] });
  await trashTrends([id(1)], "owner", db);
  assert.deepEqual(tables.trend_teams_outbox.map(r => r.status), ["cancelled", "retry", "accepted"]);
  tables.trend_workflow_items[1].deletedAt = now; // deleted without going through trashTrends (race)
  let posts = 0;
  await drainTrendOutbox((async () => { posts++; return { status: 202 }; }) as any, undefined, { db: () => db, settings: async () => ({ ...config, teamsEnabled: true, publicBaseUrl: "https://example.com" }), webhook: async () => "https://prod.api.powerplatform.com/mock" });
  assert.equal(posts, 0);
  assert.deepEqual(tables.trend_teams_outbox.map(r => r.status), ["cancelled", "cancelled", "accepted"]);
  assert.equal(tables.trend_teams_outbox.length, 3);
  await restoreTrends([id(1)], db);
  assert.equal(tables.trend_teams_outbox[0].status, "cancelled"); // restore never re-sends
});

test("tự dọn: đúng ngưỡng, bỏ qua item có nháp/đang xử lý, có trần mỗi lượt, không chạy chồng", async () => {
  const old = (d: number) => new Date(now.getTime() - d * day);
  const { db, tables } = mockDb({ trend_workflow_items: [
    item(1, { status: "skipped", updatedAt: old(8), createdAt: old(8) }),          // auto_skipped
    item(2, { status: "skipped", updatedAt: old(6), createdAt: old(6) }),          // too young
    item(3, { status: "watch", createdAt: old(31), updatedAt: old(31) }),          // auto_stale
    item(4, { status: "done", createdAt: old(40), updatedAt: old(40) }),           // has draft: keep
    item(5, { status: "researched", createdAt: old(40), updatedAt: old(40) }),     // processing: keep
    item(6, { status: "pending", createdAt: old(40), updatedAt: old(40) }),        // processing: keep
    item(7, { status: "duplicate", updatedAt: old(9), createdAt: old(9) }),        // auto_skipped
    item(8, { status: "excluded", updatedAt: old(9), createdAt: old(9) }, ),      // auto_skipped
    item(9, { status: "skipped", updatedAt: old(9), createdAt: old(9) }),          // has draft: keep
    item(10, { status: "error", attempts: 1, createdAt: old(40), updatedAt: old(40) }), // still retrying: keep
  ], trend_workflow_drafts: [{ id: "d4", itemId: id(4), remakeId: "r" }, { id: "d9", itemId: id(9), remakeId: "r" }], remakes: [{ id: "r" }] });
  const count = await cleanupTrends({ db, config, now });
  const reason = (n: number) => tables.trend_workflow_items.find(r => r.id === id(n)).deleteReason ?? null;
  assert.equal(count, 4);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(reason), ["auto_skipped", null, "auto_stale", null, null, null, "auto_skipped", "auto_skipped", null, null]);
  assert.equal(tables.trend_workflow_items.find(r => r.id === id(1)).deletedBy, "system");
  assert.equal(tables.remakes.length, 1); assert.equal(tables.trend_workflow_drafts.length, 2);
  assert.equal(tables.trend_workflow_items.length, 10); // never hard-deleted
  // Hourly gate: second call within the hour does nothing.
  tables.trend_workflow_items.push(item(11, { status: "skipped", updatedAt: old(8) }));
  assert.equal(await cleanupTrends({ db, config, now: new Date(now.getTime() + 10 * 60_000) }), 0);
  assert.equal(await cleanupTrends({ db, config, now: new Date(now.getTime() + 61 * 60_000) }), 1);
});

test("tự dọn: trần 200 dòng mỗi lượt; autoCleanup=false không làm gì", async () => {
  const many = Array.from({ length: 250 }, (_, n) => item(n + 1, { status: "skipped", updatedAt: new Date(now.getTime() - 10 * day) }));
  const { db, tables } = mockDb({ trend_workflow_items: many, trend_workflow_drafts: [] });
  assert.equal(await cleanupTrends({ db, config: { ...config, autoCleanup: false }, now }), 0);
  assert.ok(tables.trend_workflow_items.every(r => !r.deletedAt));
  assert.equal(tables.trend_workflow_lease, undefined); // disabled: does not even take the gate
  assert.equal(await cleanupTrends({ db, config, now }), 200);
  assert.equal(tables.trend_workflow_items.filter(r => r.deletedAt).length, 200);
});

test("cài đặt: mặc định bật/7/30, ngoài khoảng bị từ chối", () => {
  const routes = fs.readFileSync(path.join(process.cwd(), "server/routes/trend-workflow.routes.ts"), "utf8");
  assert.match(routes, /INVALID_RETENTION/);
  const d = normalizeSettings({});
  assert.deepEqual([d.autoCleanup, d.skippedRetentionDays, d.staleRetentionDays], [true, 7, 30]);
  assert.equal(normalizeSettings({ autoCleanup: false }).autoCleanup, false);
  assert.deepEqual([normalizeSettings({ skippedRetentionDays: 1, staleRetentionDays: 365 }).skippedRetentionDays, normalizeSettings({ staleRetentionDays: 7 }).staleRetentionDays], [1, 7]);
  for (const bad of [{ skippedRetentionDays: 0 }, { skippedRetentionDays: 91 }, { skippedRetentionDays: 2.5 }, { skippedRetentionDays: "7" }, { staleRetentionDays: 6 }, { staleRetentionDays: 366 }])
    assert.throws(() => normalizeSettings(bad), /không hợp lệ/, JSON.stringify(bad));
});

test("không có đường nào xoá cứng trend item hay remakes", () => {
  const files = ["server/services/trend-trash.ts", "server/services/trend-workflow.ts", "server/services/trend-claude.ts", "server/services/trend-teams.ts", "server/routes/trend-workflow.routes.ts"];
  for (const f of files) {
    const src = fs.readFileSync(path.join(process.cwd(), f), "utf8");
    assert.doesNotMatch(src, /\.delete\(\s*(trendWorkflowItems|items|remakes|trendWorkflowDrafts|drafts|trendTeamsOutbox|outbox)\b/, f);
    assert.doesNotMatch(src, /DELETE\s+FROM|TRUNCATE/i, f);
  }
  const routes = fs.readFileSync(path.join(process.cwd(), "server/routes/trend-workflow.routes.ts"), "utf8");
  assert.doesNotMatch(routes, /app\.delete\(/);
});

test("endpoint xoá/khôi phục: validate tối đa 200 UUID, trả count và giữ bản nháp", async () => {
  const { db, tables } = mockDb({ trend_workflow_items: [item(1), item(2)], trend_workflow_drafts: [{ itemId: id(1), remakeId: "r" }], remakes: [{ id: "r" }] });
  const routes: any[] = [];
  const app: any = { get: () => {}, put: () => {}, post: (p: string, ...h: any[]) => routes.push({ p, h }) };
  const pass: any = (_q: any, _s: any, next: any) => next();
  registerTrendWorkflowRoutes(app, { configured: () => true, db: () => db, auth: pass });
  const invoke = async (action: string, body: any) => { const out: any = {}; const res: any = { status(n: number) { out.status = n; return res; }, json(x: any) { out.body = x; return res; } };
    await routes.find(r => r.p === `/api/trend-workflow/trends/${action}`).h.at(-1)({ body, headers: { authorization: `Bearer ${token("u")}` } }, res); return out; };
  for (const ids of [[], ["bad-id"], Array.from({ length: 201 }, () => id(1)), null]) assert.equal((await invoke("delete", { ids })).status, 400);
  assert.deepEqual((await invoke("delete", { ids: [id(1), id(1)] })).body, { count: 1 });
  assert.equal(tables.trend_workflow_items[0].deletedBy, "u");
  assert.deepEqual((await invoke("restore", { ids: [id(1)] })).body, { count: 1 });
  assert.equal(tables.trend_workflow_items[0].deletedAt, null);
  assert.equal(tables.remakes.length, 1); assert.equal(tables.trend_workflow_drafts.length, 1);
});
