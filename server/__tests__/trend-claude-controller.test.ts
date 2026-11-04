import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { mockDb } from "./helpers/trend-mock-db";
import { normalizeSettings } from "../services/trend-workflow-settings";
import { refreshTrends, runTrendWorkflow } from "../services/trend-workflow";
import { briefFromClaude, discoverTrend, skipTrend, trendResearchQueue } from "../services/trend-claude";
import { rssBrief } from "../services/trend-research";

// Toàn bộ dùng mock DB/RSS: không socket, không model, không Apify.
const config = normalizeSettings({ enabled: true, researchProvider: "claude_mcp", maxTrends: 2 });
const rss = (titles: string[]) => titles.map(title => ({ title, approxTraffic: "10K+", news: [] }));
const now = new Date("2026-11-04T10:00:00Z");
const claim = { text: "Sự kiện có nguồn", urls: ["https://news.example.com/a"] };

test("trend_refresh tạo item awaiting_research, tôn trọng maxTrends, trả candidates đầy đủ", async () => {
  const { db, tables } = mockDb();
  const out = await refreshTrends({ db, config, now, trends: async () => rss(["Giá vàng", "Bão số 9", "Xổ số miền Bắc"]) });
  assert.equal(out.fetched, 3); assert.equal(out.created, 2); assert.equal(out.candidates.length, 3);
  assert.deepEqual(tables.trend_workflow_items.map(r => r.status), ["awaiting_research", "awaiting_research"]);
  assert.match(out.skipped[0].reason, /maxTrends/);
  assert.equal(out.items.length, 2);
  assert.equal(String(out.fetchedAt), String(now));
});

test("trend_refresh: trong 30 phút không đọc RSS lại; sau đó không tạo trùng item đang chờ", async () => {
  const { db, tables } = mockDb(); let reads = 0;
  const trends = async () => { reads++; return rss(["Giá vàng"]); };
  await refreshTrends({ db, config, now, trends });
  const again = await refreshTrends({ db, config, now: new Date(now.getTime() + 10 * 60_000), trends });
  assert.equal(reads, 1); assert.equal(again.created, 0); assert.equal(again.items.length, 1); assert.match(again.note, /gần đây/);
  const later = await refreshTrends({ db, config, now: new Date(now.getTime() + 31 * 60_000), trends });
  assert.equal(reads, 2); assert.equal(later.created, 0); assert.equal(tables.trend_workflow_items.length, 1);
  assert.match(later.skipped[0].reason, /Đã có/);
});

test("trend_refresh: tính năng tắt → không đọc RSS; lease bận → thông báo, không lỗi", async () => {
  const { db } = mockDb(); let reads = 0;
  const trends = async () => { reads++; return rss(["x"]); };
  const off = await refreshTrends({ db, config: { ...config, enabled: false }, now, trends });
  assert.match(off.note, /đang tắt/); assert.equal(reads, 0);
  const busy = mockDb({ trend_workflow_lease: [{ key: "default", token: "other", generation: 1, expiresAt: new Date(Date.now() + 60_000) }] });
  const out = await refreshTrends({ db: busy.db, config, now, trends });
  assert.match(out.note, /đang có lượt khác chạy/i); assert.equal(reads, 0);
});

test("trend_refresh không gọi model: mã nguồn hàm không chạm budget/research/modelCall", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "server/services/trend-workflow.ts"), "utf8");
  const body = src.slice(src.indexOf("export async function refreshTrends"), src.indexOf("export interface TrendWorkflowDeps"));
  assert.ok(body.length > 200);
  assert.doesNotMatch(body, /\bmodelCall\b|deps\.research|researchTrend|createTrendModelBudget|budget\.|gemini|apify/i);
});

test("trend_queue rỗng giải thích đúng từng tình huống", async () => {
  const { db, tables } = mockDb();
  assert.match((await trendResearchQueue(db, { ...config, enabled: false })).reasonIfEmpty!, /đang tắt/);
  const first = await trendResearchQueue(db, config);
  assert.deepEqual(first.items, []); assert.match(first.reasonIfEmpty!, /trend_refresh/); assert.equal(first.lastRefreshAt, null);
  await refreshTrends({ db, config, now, trends: async () => rss(["Giá vàng"]) });
  assert.equal((await trendResearchQueue(db, config)).reasonIfEmpty, null);
  tables.trend_workflow_items[0].status = "done";
  assert.match((await trendResearchQueue(db, config)).reasonIfEmpty!, /Đã lấy lúc .*đã được nghiên cứu/);
});

test("job nền claude_mcp: không đọc RSS, nhưng xử lý item researched ngoài khung 08-22", async () => {
  const { db, tables } = mockDb(); let reads = 0;
  const input = { title: "Giá điện", news: [] };
  const deps = { trends: async () => { reads++; return rss(["x"]); } };
  const night = new Date("2026-11-04T18:30:00Z"); // 01:30 VN
  const idle = await runTrendWorkflow({ db, config, reason: "tick", now: night, deps });
  assert.equal(idle.ran, false); assert.equal(reads, 0); assert.equal(tables.trend_workflow_runs?.length || 0, 0);
  await refreshTrends({ db, config, now: night, trends: async () => [input] });
  Object.assign(tables.trend_workflow_items[0], { status: "researched", brief: { ...rssBrief(input), decision: "pursue", decisionRationale: "test" } });
  const out = await runTrendWorkflow({ db, config, reason: "tick", now: night, deps });
  assert.equal(out.ran, true); assert.equal(reads, 0);
  assert.equal(tables.trend_workflow_items[0].status, "brief_only");
});

test("provider gemini giữ hành vi cũ: ngoài giờ không chạy, trong giờ đọc RSS", async () => {
  const { db, tables } = mockDb(); let reads = 0;
  const gem = { ...config, researchProvider: "gemini" as const };
  const deps = { trends: async () => { reads++; return rss(["Giá vàng"]); }, research: async (i: any) => rssBrief(i) };
  assert.equal((await runTrendWorkflow({ db, config: gem, reason: "t", now: new Date("2026-11-04T18:30:00Z"), deps })).ran, false);
  await runTrendWorkflow({ db, config: gem, reason: "t", now: new Date("2026-11-04T03:00:00Z"), deps });
  assert.equal(reads, 1); assert.equal(tables.trend_workflow_items[0].status, "watch"); // Gemini brief has no editorial decision
  const refused = await refreshTrends({ db, config: gem, now, trends: deps.trends });
  assert.equal(reads, 1); assert.match(refused.note, /không phải Claude/);
});

test("trend_discover: sự kiện ngoài Google Trends tạo item, nộp nghiên cứu, dedupe 48h", async () => {
  const { db, tables } = mockDb(); const dispatched: string[] = [];
  const dispatch = (r: { id: string }) => { dispatched.push(r.id); };
  const out: any = await discoverTrend({ title: "Meme AI chấm công", summary: "Cộng đồng đang chế ảnh", claims: [claim], confidence: "sourced", suggestedAngle: "Gàn chấm công", decision: "pursue", rationale: "Mới, nhiều bài chế" }, "claude", db, config, dispatch);
  assert.equal(out.status, "accepted"); assert.equal(dispatched.length, 1);
  const item = tables.trend_workflow_items[0];
  assert.equal(item.status, "researched"); assert.equal(item.input.origin, "claude_discover");
  const dup: any = await discoverTrend({ title: "meme AI chấm công!", summary: "x", claims: [claim] }, "claude", db, config, dispatch);
  assert.equal(dup.status, "duplicate"); assert.equal(tables.trend_workflow_items.length, 1);
  await assert.rejects(discoverTrend({ title: "Không nguồn", summary: "x", claims: [] }, "claude", db, config, dispatch), /URL công khai/);
  assert.equal((await discoverTrend({ title: "t", summary: "x", claims: [claim] }, "claude", db, { ...config, enabled: false }, dispatch) as any).status, "disabled");
});

test("trend_skip: item bị bỏ qua không tạo draft/outbox, refresh sau đó không đưa lại trong 48h", async () => {
  const { db, tables } = mockDb();
  await refreshTrends({ db, config, now, trends: async () => rss(["Xổ số miền Bắc"]) });
  const id = "11111111-2222-4333-8444-555555555555";
  tables.trend_workflow_items[0].id = id;
  const out = await skipTrend(id, "Sự kiện định kỳ, không có góc mới", "claude", db);
  assert.equal(out.status, "skipped"); assert.equal(tables.trend_workflow_items[0].status, "skipped");
  await runTrendWorkflow({ db, config, reason: "tick", now: new Date(now.getTime() + 3 * 3600_000) });
  assert.equal(tables.trend_workflow_items[0].status, "skipped");
  assert.equal((tables.trend_workflow_drafts || []).length, 0); assert.equal((tables.trend_teams_outbox || []).length, 0);
  const again = await refreshTrends({ db, config, now: new Date(now.getTime() + 3600_000), trends: async () => rss(["Xổ số miền Bắc"]) });
  assert.equal(again.created, 0);
  await assert.rejects(skipTrend(id, "lại", "claude", db), /không còn chờ/);
  await assert.rejects(skipTrend(id, "  ", "claude", db), /lý do/);
});

test("nguồn: metadata chỉ gắn với URL có trong claims, không có thì dùng hostname", () => {
  const b = briefFromClaude("Bão", { summary: "s", claims: [{ text: "c", urls: ["https://vnexpress.net/bao-9.html", "https://tuoitre.vn/x"] }],
    sources: [{ url: "https://vnexpress.net/bao-9.html", title: "Bão số 9 đổ bộ", publisher: "VnExpress", publishedAt: "2026-11-04" }, { url: "https://evil.example.com/not-cited", title: "Bịa" }, { url: "https://tuoitre.vn/x", publishedAt: "hôm qua" }] });
  assert.deepEqual(b.sources[0], { url: "https://vnexpress.net/bao-9.html", title: "Bão số 9 đổ bộ", publisher: "VnExpress", publishedAt: "2026-11-04" });
  assert.deepEqual(b.sources[1], { url: "https://tuoitre.vn/x", title: "tuoitre.vn/x" });
  assert.equal(b.sources.length, 2);
  const legacy = briefFromClaude("Bão", { summary: "s", claims: [{ text: "c", urls: ["https://a.example.com/"] }] });
  assert.equal(legacy.sources[0].title, "a.example.com");
});

test("API công khai: discoverySource/skipReason dẫn xuất, không lộ input thô", async () => {
  const { trendItemPublicFields } = await import("../routes/trend-workflow.routes");
  assert.deepEqual(trendItemPublicFields({ status: "skipped", error: "Claude bỏ qua: Xổ số định kỳ", input: { origin: "claude_discover" } }), { decision: "skip", discoverySource: "claude", skipReason: "Xổ số định kỳ", error: null });
  assert.deepEqual(trendItemPublicFields({ status: "error", error: "x", input: { title: "a", news: [] } }), { decision: null, discoverySource: "google_trends", skipReason: null, error: "x" });
  const src = fs.readFileSync(path.join(process.cwd(), "server/routes/trend-workflow.routes.ts"), "utf8");
  assert.match(src, /hasTargets: settings\.targets\.length > 0/);
});

test("quyết định biên tập: sourced nhưng watch/thiếu decision → không nháp, không outbox; pursue mới xử lý", async () => {
  const { submitTrendResearch } = await import("../services/trend-claude");
  const { db, tables } = mockDb(); const dispatched: string[] = [];
  await refreshTrends({ db, config, now, trends: async () => rss(["Xổ số miền Bắc", "Giá vàng", ]) });
  const [a, b] = tables.trend_workflow_items;
  const sourced = { summary: "Có kết quả xổ số", claims: [claim], confidence: "sourced" as const };
  const legacy: any = await submitTrendResearch(a.id, sourced, "claude", db, r => dispatched.push(r.id));
  assert.equal(legacy.itemStatus, "watch"); assert.equal(a.status, "watch"); assert.equal(a.brief.decision, "watch"); assert.equal(dispatched.length, 0);
  await assert.rejects(submitTrendResearch(b.id, { ...sourced, decision: "maybe" as any }, "claude", db), /decision/);
  await assert.rejects(submitTrendResearch(b.id, { ...sourced, decision: "pursue", rationale: "x" }, "claude", db), /góc nội dung/);
  await assert.rejects(submitTrendResearch(b.id, { ...sourced, decision: "skip" }, "claude", db), /rationale/);
  const skip: any = await submitTrendResearch(b.id, { ...sourced, decision: "skip", rationale: "Định kỳ, không có góc" }, "claude", db);
  assert.equal(skip.itemStatus, "skipped"); assert.equal(b.status, "skipped");
  // Even with targets configured and long after the 90-minute window, worker never drafts watch/skip.
  const withTargets = { ...config, targets: [{ brandId: "00000000-0000-4000-8000-000000000aaa", fanpageId: "00000000-0000-4000-8000-000000000bbb" }] };
  await runTrendWorkflow({ db, config: withTargets, reason: "tick", now: new Date(now.getTime() + 3 * 3600_000) });
  assert.equal(a.status, "watch"); assert.equal(b.status, "skipped");
  assert.equal((tables.trend_workflow_drafts || []).length, 0); assert.equal((tables.trend_teams_outbox || []).length, 0);
  // watch can later become pursue with an angle.
  const pursue: any = await submitTrendResearch(a.id, { ...sourced, decision: "pursue", rationale: "Có meme mới quanh kết quả", pageAngles: [{ pageName: "Ăn Nằm Với AI", angle: "Gàn nhờ AI dò số" }] }, "claude", db, r => dispatched.push(r.id));
  assert.equal(pursue.itemStatus, "researched"); assert.equal(a.brief.pageAngles[0].angle, "Gàn nhờ AI dò số"); assert.equal(dispatched.length, 1);
});

test("worker: brief Claude legacy (không decision) đã researched không bị dựng nháp", async () => {
  const { db, tables } = mockDb();
  await refreshTrends({ db, config, now, trends: async () => rss(["Giá điện"]) });
  Object.assign(tables.trend_workflow_items[0], { status: "researched", brief: briefFromClaude("Giá điện", { summary: "s", claims: [claim], confidence: "sourced" }) });
  await runTrendWorkflow({ db, config, reason: "tick", now });
  assert.equal(tables.trend_workflow_items[0].status, "watch"); assert.equal((tables.trend_teams_outbox || []).length, 0);
});

test("trend_discover với decision=skip lưu bỏ qua, không dispatch", async () => {
  const { db, tables } = mockDb(); let dispatched = 0;
  const out: any = await discoverTrend({ title: "Sự kiện lạ", summary: "s", claims: [claim], decision: "skip", rationale: "Không có góc an toàn" }, "claude", db, config, () => { dispatched++; });
  assert.equal(out.itemStatus, "skipped"); assert.equal(dispatched, 0); assert.equal(tables.trend_workflow_items[0].status, "skipped");
});

test("trend_discover: trần maxTrends mỗi 30 phút và lease bận trả thông báo, không tạo item", async () => {
  const { db, tables } = mockDb();
  const mk = (t: string, i: number) => discoverTrend({ title: t, summary: "s", claims: [{ text: t, urls: [`https://n${i}.example.com/${i}`] }], decision: "watch" }, "claude", db, config, () => {});
  await mk("Một", 1); await mk("Hai", 2);
  assert.equal((await mk("Ba", 3) as any).status, "capped");
  assert.equal(tables.trend_workflow_items.length, 2);
  tables.trend_workflow_lease.find((l: any) => l.key === "default").expiresAt = new Date(Date.now() + 60_000);
  const { db: db2, tables: t2 } = mockDb({ trend_workflow_lease: [{ key: "default", token: "x", generation: 1, expiresAt: new Date(Date.now() + 60_000) }] });
  const busy: any = await discoverTrend({ title: "Bốn", summary: "s", claims: [claim], decision: "watch" }, "claude", db2, config, () => {});
  assert.equal(busy.status, "busy"); assert.equal((t2.trend_workflow_items || []).length, 0);
});

test("MCP schema: tool ghi mới khai decision/sources và nằm ngoài READONLY_TOOLS", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "server/routes/mcp-signals.routes.ts"), "utf8");
  for (const n of ["trend_refresh", "trend_discover", "trend_skip"]) assert.match(src, new RegExp(`if \\(name === "${n}"\\)`));
  assert.match(src, /decision: \{ type: "string", enum: \["pursue", "watch", "skip"\]/);
  assert.match(src, /publishedAt: \{ type: "string"/);
});

test("refresh song song: contender trả busy, chỉ owner đọc RSS và tạo item", async () => {
  const { db, tables } = mockDb();
  let unblock!: () => void; let entered!: () => void;
  const gate = new Promise<void>(resolve => { unblock = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  let reads = 0;
  const first = refreshTrends({ db, config, now, trends: async () => { reads++; entered(); await gate; return rss(["Meme AI"]); } });
  await started;
  const contender = await refreshTrends({ db, config, now, trends: async () => { reads++; return rss(["Meme AI"]); } });
  assert.match(contender.note, /Đang có lượt khác chạy/); assert.equal(reads, 1);
  unblock();
  assert.equal((await first).created, 1); assert.equal(tables.trend_workflow_items.length, 1);
});

test("cổng biên tập chung: fallback 90 phút / gemini / off / retry / dry-run không có pursue đều không Apify, không model viết, không nháp, không outbox", async () => {
  const targets = [{ brandId: "00000000-0000-4000-8000-000000000aaa", fanpageId: "00000000-0000-4000-8000-000000000bbb" }];
  const forbidden = () => { throw new Error("side effect forbidden"); };
  const deps: any = { trends: async () => rss(["Giá gas"]), research: async (i: any) => rssBrief(i), structure: forbidden, write: forbidden, concepts: forbidden, postStructure: forbidden,
    facebook: { fetch: forbidden, configured: () => true, budget: forbidden } };
  for (const [name, cfg, dryRun] of [["claude-90p", config, false], ["gemini", { ...config, researchProvider: "gemini" }, false], ["off", { ...config, researchProvider: "off" }, false], ["dry-run", config, true]] as const) {
    const { db, tables } = mockDb();
    const c: any = { ...cfg, targets, apifyEnabled: true, teamsEnabled: true };
    if (name === "claude-90p" || name === "dry-run") {
      await refreshTrends({ db, config: c, now, trends: deps.trends, dryRun });
      tables.trend_workflow_items[0].createdAt = new Date(Date.now() - 91 * 60_000);
      await runTrendWorkflow({ db, config: c, reason: name, dryRun, queuedRunId: dryRun ? tables.trend_workflow_items[0].runId : undefined, deps });
    } else await runTrendWorkflow({ db, config: c, reason: name, now: new Date("2026-11-04T03:00:00Z"), deps });
    const item = tables.trend_workflow_items[0];
    assert.equal(item.status, "watch", name);
    assert.equal((tables.trend_workflow_drafts || []).length, 0, name);
    assert.equal((tables.trend_teams_outbox || []).length, 0, name);
    assert.equal((tables.deconstructions || []).length, 0, name);
    // Retry pass: watch is terminal, nothing re-runs.
    item.attempts = 0;
    await runTrendWorkflow({ db, config: c, reason: "retry", dryRun, now: new Date(Date.now() + 5 * 3600_000), deps });
    assert.equal(item.status, "watch", name + " retry");
  }
});

test("chạy thử với claude_mcp: run dryRun bền; submit pursue sau đó không enqueue Teams kể cả gọi worker quên cờ dryRun", async () => {
  const { submitTrendResearch } = await import("../services/trend-claude");
  const { db, tables } = mockDb();
  const out = await refreshTrends({ db, config, now, trends: async () => rss(["Meme mới"]), dryRun: true, source: "chạy thử" });
  assert.equal(out.created, 1);
  const run = tables.trend_workflow_runs[0]; assert.equal(run.dryRun, true);
  const item = tables.trend_workflow_items[0];
  const dispatched: any[] = [];
  await submitTrendResearch(item.id, { summary: "s", claims: [claim], decision: "pursue", rationale: "mới", suggestedAngle: "góc" }, "claude", db, r => dispatched.push(r));
  assert.equal(dispatched[0].dryRun, true);
  await runTrendWorkflow({ db, config, reason: "Claude nộp nghiên cứu", queuedRunId: run.id }); // dryRun flag intentionally omitted
  assert.equal(item.status, "brief_only"); assert.equal((tables.trend_teams_outbox || []).length, 0);
  // Real refresh is not blocked by the dry-run cooldown or dedupe.
  assert.equal((await refreshTrends({ db, config, now, trends: async () => rss(["Meme mới"]) })).created, 1);
});

test("send-test: item không pursue → DECISION_REQUIRED; item chạy thử → DRY_RUN_ONLY", async () => {
  const { trendSendDecisionGuard } = await import("../routes/trend-workflow.routes");
  for (const decision of [undefined, "watch", "skip"]) assert.equal(trendSendDecisionGuard({ brief: { confidence: "sourced", decision } })?.code, "DECISION_REQUIRED");
  assert.equal(trendSendDecisionGuard({ brief: { decision: "pursue" } }, true)?.code, "DRY_RUN_ONLY");
  assert.equal(trendSendDecisionGuard({ brief: { decision: "pursue" } }), null);
  const src = fs.readFileSync(path.join(process.cwd(), "server/routes/trend-workflow.routes.ts"), "utf8");
  const send = src.slice(src.indexOf('"/api/trend-workflow/trends/:id/send-test"'));
  assert.ok(send.indexOf("trendSendDecisionGuard") > 0 && send.indexOf("trendSendDecisionGuard") < send.indexOf("trendTeamsOutbox).values"));
});
