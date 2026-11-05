import { test } from "node:test";
import assert from "node:assert/strict";
import { mockDb } from "./helpers/trend-mock-db";
import { normalizeSettings } from "../services/trend-workflow-settings";
import { runTrendWorkflow } from "../services/trend-workflow";
import { trendResearchStatus } from "../services/trend-claude";
import { TrendLeaseLost } from "../services/trend-model-budget";
import { rssBrief } from "../services/trend-research";

// Mock DB only: no socket, no Teams, no model, no Apify.
const ITEM = "2d2da423-0006-4f2c-aad0-d6f713dc38ec";
const PAGE_A = "00000000-0000-4000-8000-00000000000a";
const PAGE_B = "00000000-0000-4000-8000-00000000000b";
const input = { title: "Bông hoa chưa nở", news: [] };
const brief = { ...rssBrief(input), decision: "pursue", decisionRationale: "test" };
const config = normalizeSettings({ enabled: true, researchProvider: "claude_mcp", maxModelCalls: 20, maxModelCallsDaily: 60, publicBaseUrl: "https://outlier.example.com",
  targets: [{ brandId: "brand", fanpageId: PAGE_A }, { brandId: "brand", fanpageId: PAGE_B }] });

function setup(o: { dryRun?: boolean; item?: any; extra?: Record<string, any[]> } = {}) {
  return mockDb({
    trend_workflow_runs: [{ id: "run", slot: "discover:2026-11-05", dryRun: Boolean(o.dryRun), status: "partial", modelCalls: 0, apifyPosts: 0, maxModelCalls: 20, createdAt: new Date() }],
    trend_workflow_items: [{ id: ITEM, runId: "run", inputKey: "bong hoa", title: input.title, input, brief, attempts: 0, status: "researched", deletedAt: null, createdAt: new Date(), updatedAt: new Date(), ...o.item }],
    brands: [{ id: "brand", name: "Brand" }],
    brand_fanpages: [{ id: PAGE_A, brandId: "brand", pageName: "Gàn và Gèn", pageUrl: "https://facebook.com/a" }, { id: PAGE_B, brandId: "brand", pageName: "Ăn Thịt Anh Lập Trình", pageUrl: "https://facebook.com/b" }],
    ...o.extra,
  });
}
const counters = () => ({ writes: 0, fetches: 0, concepts: 0 });
function deps(c: ReturnType<typeof counters>, o: { write?: (page: string) => any; concepts?: () => any } = {}) {
  let page = "";
  return {
    pageCharacters: async (_b: string, p: string) => { page = p; return []; },
    facebook: { configured: () => true, budget: async () => ({ ok: true, resultsLeft: 10, runsLeft: 10 }), fetch: async () => { c.fetches++; throw new Error("Apify forbidden in test"); } } as any,
    structure: async () => ({ structure: { formula: "Góc hoa" } }),
    write: async () => { c.writes++; return o.write ? o.write(page) : { draft: `Bản nháp ${page}` }; },
    concepts: async () => { c.concepts++; if (o.concepts) return o.concepts(); },
  };
}
const run = (db: any, d: any, dryRun = false) => runTrendWorkflow({ db, config, queuedRunId: "run", dryRun, reason: "test", deps: d });
const conceptsParseError = () => { throw new Error("Model trả về phương án ảnh không đúng dạng, thử hai lần vẫn hỏng."); };

test("concepts lỗi → draft vẫn ready kèm lỗi ý tưởng ảnh, thẻ Teams được xếp, item không error", async () => {
  const { db, tables } = setup(); const c = counters();
  await run(db, deps(c, { concepts: conceptsParseError }));
  const item = tables.trend_workflow_items[0];
  assert.equal(item.status, "done"); assert.equal(item.error, null);
  assert.equal(tables.trend_workflow_drafts.length, 2);
  for (const d of tables.trend_workflow_drafts) { assert.equal(d.status, "ready"); assert.match(d.error, /Ý tưởng ảnh lỗi/); }
  assert.ok(tables.remakes.every(r => /Ý tưởng ảnh lỗi/.test(r.imageError)));
  assert.equal(tables.trend_teams_outbox.length, 1);
  const urls = tables.trend_teams_outbox[0].payload.attachments[0].content.actions.map((a: any) => a.url);
  assert.equal(urls.filter((u: string) => /remakeId=/.test(u)).length, 2);
  // Lần chạy sau không gọi lại concepts (tránh tốn tiền), không viết lại nháp.
  item.status = "researched"; item.lastAttemptSlot = null;
  const calls = c.concepts;
  await run(db, deps(c, { concepts: conceptsParseError }));
  assert.equal(c.concepts, calls); assert.equal(c.writes, 2);
  // Mock không áp unique idempotencyKey; Postgres thì có — cùng key nghĩa là không gửi trùng.
  assert.deepEqual([...new Set(tables.trend_teams_outbox.map(r => r.idempotencyKey))], [`trend-item:${ITEM}`]);
});

test("dry-run: concepts lỗi vẫn ready nhưng không xếp thẻ Teams", async () => {
  const { db, tables } = setup({ dryRun: true }); const c = counters();
  await run(db, deps(c, { concepts: conceptsParseError }), true);
  assert.equal(tables.trend_workflow_items[0].status, "done");
  assert.equal((tables.trend_teams_outbox || []).length, 0);
});

test("một page viết nháp lỗi, page kia ok → enqueue với đúng 1 nút bản nháp", async () => {
  const { db, tables } = setup(); const c = counters();
  await run(db, deps(c, { write: page => { if (page === PAGE_A) throw new Error("model im lặng"); return { draft: "ok" }; } }));
  assert.equal(tables.trend_workflow_items[0].status, "done");
  const a = tables.trend_workflow_drafts.find(d => d.fanpageId === PAGE_A); const b = tables.trend_workflow_drafts.find(d => d.fanpageId === PAGE_B);
  assert.equal(a.status, "error"); assert.equal(a.remakeId, null); assert.match(a.error, /model im lặng/);
  assert.equal(b.status, "ready"); assert.equal(b.error, null);
  const actions = tables.trend_teams_outbox[0].payload.attachments[0].content.actions;
  assert.deepEqual(actions.filter((x: any) => /remakeId=/.test(x.url)).map((x: any) => x.title), ["Mở bản nháp"]);
  const status: any = await trendResearchStatus(ITEM, db);
  assert.equal(status.drafts.find((d: any) => d.fanpageId === PAGE_A).href, null);
});

test("cả hai page viết nháp lỗi → item error, không enqueue", async () => {
  const { db, tables } = setup(); const c = counters();
  await run(db, deps(c, { write: () => { throw new Error("quota"); } }));
  assert.equal(tables.trend_workflow_items[0].status, "error"); assert.match(tables.trend_workflow_items[0].error, /quota/);
  assert.equal((tables.trend_teams_outbox || []).length, 0);
  assert.ok(tables.trend_workflow_drafts.every(d => d.status === "error"));
});

test("retry item lỗi đã có remake (như 2d2da423) → không viết lại nháp, không gọi Apify, concepts lỗi vẫn enqueue", async () => {
  const facebook = { state: "complete", path: "brief_only", reason: "Không tìm thấy link bài Facebook trong nguồn nghiên cứu." };
  const { db, tables } = setup({
    item: { status: "error", attempts: 1, error: "Model trả về phương án ảnh không đúng dạng, thử hai lần vẫn hỏng.", facebook, deconstructionId: "decon", lastAttemptSlot: "old", updatedAt: new Date(Date.now() - 3 * 3600_000) },
    extra: {
      deconstructions: [{ id: "decon", structure: { formula: "Góc hoa" } }],
      remakes: [{ id: "remake-a", draft: "Nháp A", imageConceptsJson: null }, { id: "remake-b", draft: "Nháp B", imageConceptsJson: null }],
      trend_workflow_drafts: [
        { id: "da", itemId: ITEM, brandId: "brand", fanpageId: PAGE_A, remakeId: "remake-a", pageName: "Gàn và Gèn", angle: "Góc hoa", status: "pending", error: null },
        { id: "db", itemId: ITEM, brandId: "brand", fanpageId: PAGE_B, remakeId: "remake-b", pageName: "Ăn Thịt Anh Lập Trình", angle: "Góc hoa", status: "pending", error: null },
      ],
    },
  });
  const c = counters();
  // Worker theo lịch (không queuedRunId) — đúng cơ chế tự retry sau giãn cách 2 giờ.
  await runTrendWorkflow({ db, config, reason: "test", deps: deps(c, { concepts: conceptsParseError }) });
  assert.equal(c.writes, 0); assert.equal(c.fetches, 0); assert.equal(c.concepts, 2);
  assert.equal(tables.trend_workflow_items[0].status, "done"); assert.equal(tables.trend_workflow_items[0].attempts, 2);
  assert.equal(tables.remakes.length, 2);
  assert.ok(tables.trend_workflow_drafts.every(d => d.status === "ready"));
  assert.equal(tables.trend_teams_outbox.length, 1);
});

test("mất lease/fence trong concepts vẫn dừng lượt, không nuốt lỗi", async () => {
  const { db, tables } = setup(); const c = counters();
  const out: any = await run(db, deps(c, { concepts: () => { throw new TrendLeaseLost(); } }));
  assert.equal(out.ran, false); assert.match(out.reason, /Mất lease/);
  assert.notEqual(tables.trend_workflow_items[0].status, "done"); assert.notEqual(tables.trend_workflow_items[0].status, "error");
  assert.equal((tables.trend_teams_outbox || []).length, 0);
  assert.ok(!tables.trend_workflow_drafts.some(d => d.status === "ready"));
});

test("trend_status trả link remake + trạng thái ý tưởng ảnh từng page", async () => {
  const { db } = setup(); const c = counters();
  let n = 0;
  await run(db, deps(c, { concepts: () => { if (n++ === 0) conceptsParseError(); } }));
  const status: any = await trendResearchStatus(ITEM, db);
  const [a, b] = [PAGE_A, PAGE_B].map(p => status.drafts.find((d: any) => d.fanpageId === p));
  assert.match(a.href, /^\/remakes\?remakeId=/); assert.equal(a.imageIdeas, "error"); assert.match(a.note, /Ý tưởng ảnh lỗi, tạo lại trong trang remake/);
  assert.match(b.href, /^\/remakes\?remakeId=/); assert.equal(b.imageIdeas, "ok");
});

test("bước concepts của workflow gọi model ở JSON mode + khuôn (gốc lỗi markdown)", async () => {
  const { db } = setup(); const c = counters(); const requests: any[] = [];
  const d: any = { ...deps(c), modelCall: async (r: any) => { requests.push(r); return { text: "{}" }; },
    concepts: async (_id: string, _p: string, generate: (p: string) => Promise<string>) => { await generate("x"); } };
  await run(db, d);
  assert.ok(requests.length >= 1);
  assert.ok(requests.every(r => r.config.responseMimeType === "application/json" && r.config.responseSchema?.properties?.concepts));
});
