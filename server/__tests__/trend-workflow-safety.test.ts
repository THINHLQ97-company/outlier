import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createTrendModelBudget, TrendBudgetExceeded, TrendLeaseLost } from "../services/trend-model-budget";
import { normalizeSettings } from "../services/trend-workflow-settings";
import { acquireTrendLease, assertTrendFence, runTrendWorkflow, trendPageBrief } from "../services/trend-workflow";
import { drainTrendOutbox, recoverStaleTrendOutbox, resolveTrendOutbox } from "../services/trend-teams";
import { readLimitedRss } from "../services/google-trends";
import { registerTrendWorkflowRoutes, sendTestGuard } from "../routes/trend-workflow.routes";
import { rssBrief } from "../services/trend-research";
import { proposeImageConcepts } from "../services/image-concepts";

import { mockDb } from "./helpers/trend-mock-db";
export { mockDb };
const config = normalizeSettings({ enabled: true, researchProvider: "gemini", maxModelCalls: 2, maxModelCallsDaily: 20 });
const input = { title: "Giá máy tính", news: [] };
// These tests cover retry/lease mechanics, so the brief explicitly passes the editorial gate.
const pursue = (b: any) => ({ ...b, decision: "pursue", decisionRationale: "test" });

test("all model attempts share token cap/deadline, including fallback", async () => {
  const old = process.env.GEMINI_TEXT_MODEL_FALLBACK;
  process.env.GEMINI_TEXT_MODEL_FALLBACK = "fallback";
  try {
    let used = 0; const requests: any[] = [];
    const budget = createTrendModelBudget(config, async () => ++used <= 2, async () => {}, async req => {
      requests.push(req); if (requests.length === 1) throw Object.assign(new Error("not found"), { status: 404 }); return { text: "ok" } as any;
    });
    assert.equal(await budget.text("a"), "ok");
    await assert.rejects(budget.text("b"), TrendBudgetExceeded);
    assert.equal(requests.length, 2);
    assert.ok(requests.every(r => r.config.maxOutputTokens === config.maxOutputTokens && r.config.httpOptions.timeout === config.modelTimeoutMs));
  } finally { if (old === undefined) delete process.env.GEMINI_TEXT_MODEL_FALLBACK; else process.env.GEMINI_TEXT_MODEL_FALLBACK = old; }
});
test("hung model times out, fence loss prevents results being saved", async () => {
  const budget = createTrendModelBudget({ ...config, modelTimeoutMs: 10 }, async () => true, async () => {}, async () => new Promise(() => {}));
  await assert.rejects(budget.text("a"), /quá thời gian/);
  let n = 0;
  const lost = createTrendModelBudget(config, async () => true, async () => { if (++n > 1) throw new TrendLeaseLost(); }, async () => ({ text: "late" }) as any);
  await assert.rejects(lost.text("a"), TrendLeaseLost);
});
test("concept parse fallback spends the same shared budget", async () => {
  let calls = 0;
  const budget = createTrendModelBudget(config, async () => ++calls <= 1, async () => {}, async () => ({ text: "invalid" }) as any);
  await assert.rejects(proposeImageConcepts({ draft: "draft", characterNames: [] }, 3, budget.text), TrendBudgetExceeded);
  assert.equal(calls, 2); // second reservation denied, only one HTTP attempt
});
test("RSS enforces declared and streamed size limits; cancels stream", async () => {
  await assert.rejects(readLimitedRss(new Response("12345"), 4), /kích thước/);
  await assert.rejects(readLimitedRss(new Response("1", { headers: { "content-length": "99" } }), 4), /kích thước/);
  assert.equal(await readLimitedRss(new Response("abc"), 4), "abc");
});
test("page-specific voice context never includes sibling page", () => {
  const brief = trendPageBrief("Brand", { pageName: "Page B", pageUrl: "url", audienceNote: "Gen Z", note: "xưng tớ", topics: ["AI"] }, [{ name: "B" }]);
  assert.match(brief, /Page B/); assert.match(brief, /Gen Z/); assert.match(brief, /xưng tớ/); assert.doesNotMatch(brief, /Page A/);
});
test("DB mock: lease CAS excludes contender, generation fences stale owner", async () => {
  const { db, tables } = mockDb();
  assert.equal(await acquireTrendLease("a", db), 1);
  assert.equal(await acquireTrendLease("b", db), null);
  tables.trend_workflow_lease[0].expiresAt = new Date(0);
  assert.equal(await acquireTrendLease("b", db), 2);
  await assert.rejects(assertTrendFence(db, "a", 1), TrendLeaseLost);
  await assertTrendFence(db, "b", 2);
});
test("DB mock: run partial, next slot retries failed only, max 3 attempts", async () => {
  const { db, tables } = mockDb();
  let failures = true; let calls = 0;
  const deps = { trends: async () => [input], research: async () => { calls++; if (failures) throw new Error("mock failed"); return pursue(rssBrief(input)); } };
  const run = (hour: number) => runTrendWorkflow({ db, config, reason: "test", now: new Date(`2026-11-03T${String(hour).padStart(2, "0")}:00:00Z`), deps });
  await run(1);
  assert.equal(tables.trend_workflow_runs[0].status, "partial");
  await run(1); assert.equal(calls, 1); // not every 5-minute tick
  failures = false;
  await run(3);
  assert.equal(tables.trend_workflow_items[0].status, "brief_only");
  assert.equal(tables.trend_workflow_items[0].attempts, 2);
  assert.equal(tables.trend_workflow_runs[0].status, "done");
  assert.equal(tables.trend_workflow_items[1].status, "duplicate"); // same trend in new slot is merged
  failures = true;
  tables.trend_workflow_items[0].status = "error";
  await run(5); await run(7);
  assert.equal(tables.trend_workflow_items[0].attempts, 3);
});
test("DB mock: interrupted item in same slot resumes once restarted", async () => {
  const { db, tables } = mockDb();
  const now = new Date("2026-11-03T01:00:00Z");
  await runTrendWorkflow({ db, config, reason: "test", now, deps: { trends: async () => [input], research: async () => { throw new Error("x"); } } });
  Object.assign(tables.trend_workflow_items[0], { status: "researched", brief: pursue(rssBrief(input)) });
  tables.trend_workflow_runs[0].status = "running";
  await runTrendWorkflow({ db, config, reason: "test", now, deps: { trends: async () => [input] } });
  assert.equal(tables.trend_workflow_items[0].status, "brief_only");
});
test("DB mock: budget exhaustion stops remaining pipeline items", async () => {
  const { db, tables } = mockDb(); let network = 0;
  await runTrendWorkflow({ db, config: { ...config, maxModelCalls: 1 }, dryRun: true, reason: "test", deps: {
    trends: async () => [input, { ...input, title: "Giá điện" }],
    modelCall: async () => { network++; return { text: "ok" } as any; },
    research: async (i, _c, invoke) => { await invoke("research"); await invoke("second"); return rssBrief(i); },
  } });
  assert.equal(network, 1);
  assert.equal(tables.trend_workflow_runs[0].status, "partial");
  assert.deepEqual(tables.trend_workflow_items.map(r => r.status), ["budget_exhausted", "budget_exhausted"]);
});
test("DB mock: concurrent drains send once, stale sending becomes unknown and never auto-resends", async () => {
  const { db, tables } = mockDb({ trend_teams_outbox: [{ id: "x", status: "pending", attempts: 0, nextAttemptAt: new Date(0), payload: {} }] });
  let calls = 0;
  const post: any = async () => { calls++; return { status: 202 }; };
  const deps = { db: () => db, settings: async () => ({ ...config, teamsEnabled: true, publicBaseUrl: "https://example.com" }), webhook: async () => "https://prod.api.powerplatform.com/mock" };
  await Promise.all([drainTrendOutbox(post, undefined, deps), drainTrendOutbox(post, undefined, deps)]);
  assert.equal(calls, 1); assert.equal(tables.trend_teams_outbox[0].status, "accepted");
  Object.assign(tables.trend_teams_outbox[0], { status: "sending", sendingAt: new Date(0) });
  await recoverStaleTrendOutbox(db);
  assert.equal(tables.trend_teams_outbox[0].status, "unknown");
  await drainTrendOutbox(post, undefined, deps); assert.equal(calls, 1);
  await resolveTrendOutbox("x", "resolved", "admin", db);
  assert.equal(tables.trend_teams_outbox[0].resolvedBy, "admin");
});
test("route guard: missing public URL consumes no quota; exhausted quota blocks", async () => {
  let calls = 0;
  const deps = { settings: async () => config, reserve: async () => { calls++; return false; } };
  assert.equal((await sendTestGuard("admin", deps))?.code, "BASE_URL_REQUIRED"); assert.equal(calls, 0);
  assert.equal((await sendTestGuard("admin", { ...deps, settings: async () => ({ ...config, publicBaseUrl: "https://example.com" }) }))?.status, 429);
});
test("route handlers: dry-run returns 202 before work, send-test propagates guard 429", async () => {
  const app = express(); app.use(express.json());
  const pass: any = (_req: any, _res: any, next: any) => next();
  registerTrendWorkflowRoutes(app, { configured: () => true, auth: pass, admin: pass, queue: async () => ({ runId: "queued", status: "pending" }), guard: async () => ({ status: 429, code: "RATE_LIMITED", error: "mock" }) });
  // Invoke Express route stack directly: no HTTP/network calls in tests.
  const invoke = async (path: string, body: any) => {
    const layer = (app as any)._router.stack.find((r: any) => r.route?.path === path && r.route.methods.post);
    const result: any = {};
    const res: any = { status(n: number) { result.status = n; return res; }, json(x: any) { result.body = x; return res; } };
    await layer.route.stack.at(-1).handle({ body, params: { id: "x" } }, res);
    return result;
  };
  assert.equal((await invoke("/api/trend-workflow/run", { dryRun: true })).status, 202);
  const blocked = await invoke("/api/trend-workflow/trends/:id/send-test", { confirm: true, idempotencyKey: "testmock1" });
  assert.equal(blocked.status, 429); assert.equal(blocked.body.code, "RATE_LIMITED");
});
