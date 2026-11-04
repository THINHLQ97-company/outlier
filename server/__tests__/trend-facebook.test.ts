import { test } from "node:test";
import assert from "node:assert/strict";
import { facebookPostUrl } from "../services/trend-facebook-url";
import { briefFromClaude } from "../services/trend-claude";
import { normalizeSettings } from "../services/trend-workflow-settings";
import { obtainTrendPost, type FacebookCheckpoint } from "../services/trend-facebook";
import { structureFetchedPost } from "../services/fetched-post-structure";
import { mockDb } from "./helpers/trend-mock-db";
import { runTrendWorkflow } from "../services/trend-workflow";
const url = "https://www.facebook.com/example/posts/123";
const config = normalizeSettings({ apifyEnabled: true });
const input = { summary: "Hãng công nghệ ra mắt máy tính mới", confidence: "sourced" as const,
  claims: [{ text: "Hãng công nghệ ra mắt máy tính mới", urls: ["https://news.example.com/a", url] }], facebookCandidates: [{ url, reason: "Bài gốc liên quan" }],
  decision: "pursue" as const, rationale: "Sự kiện mới, cộng đồng đang bàn", suggestedAngle: "Gàn thử máy mới" };
const brief = () => ({ ...briefFromClaude("Máy tính mới", input), decision: "pursue" as const, decisionRationale: input.rationale });
test("Facebook: bài lẻ hợp lệ, loại trang/hồ sơ/nhóm và hostname giả", () => {
  for (const raw of [url, "https://fb.watch/abc/", "https://facebook.com/groups/123/posts/456", "https://facebook.com/permalink.php?story_fbid=123&id=2", "https://facebook.com/photo.php?fbid=123", "https://facebook.com/share/p/abc", "https://facebook.com/reel/123", "https://facebook.com/u/videos/123"]) assert.ok(facebookPostUrl(raw), raw);
  for (const raw of ["https://facebook.com/", "https://facebook.com/example", "https://facebook.com/groups/123", "https://facebook.com/profile.php?id=1", "https://facebook.com/example/posts", "https://facebook.com/story.php", "https://facebook.com.evil.com/u/posts/1", "file:///etc/passwd"]) assert.equal(facebookPostUrl(raw), null, raw);
});
test("Claude submit: nguồn sai loại bị loại, thiếu nguồn chưa xác minh, ứng viên có trích dẫn xếp trước", () => {
  const b = briefFromClaude("Máy tính", { ...input, claims: [{ text: "a", urls: ["file:///etc/passwd", "http://127.0.0.1/a", "http://10.0.0.1/a"] }], facebookCandidates: [{ url: "javascript:alert(1)", reason: "x" }, { url: "https://facebook.com/example", reason: "x" }, { url, reason: "Bài lẻ" }] });
  assert.equal(b.confidence, "unverified"); assert.equal(b.sources.length, 0);
  assert.equal(b.facebookCandidates?.filter(c => c.accepted).length, 1);
  assert.equal(b.facebookCandidates?.find(c => !c.url)?.rejection, "Không phải link http(s) công khai.");
  assert.equal(brief().provider, "claude_mcp"); assert.equal(brief().facebookCandidates?.[0].cited, true);
  assert.equal(briefFromClaude("clip riêng tư", input).facebookCandidates?.length || 0, 0);
});
const deps = (fetch: any = async () => ({ post: { url, kind: "post", text: "Một bài thật đủ nội dung để phân tích cách triển khai và tạo bản nháp." } })) => ({ configured: () => true, budget: async () => ({ ok: true, runsLeft: 10, resultsLeft: 10 }), fetch });
async function obtain(b = brief(), cfg = config, dep = deps(), reserve = true, cached: FacebookCheckpoint | null = null) {
  const checkpoints: FacebookCheckpoint[] = [];
  const result = await obtainTrendPost(b, cfg, cached, { reserve: async () => reserve, save: async v => { checkpoints.push(v); }, fence: async () => {} }, dep);
  return { result, checkpoints };
}
test("Apify chỉ gọi một lần đúng link; checkpoint tránh lấy lại kể cả retry", async () => {
  const calls: string[] = []; const dep = deps(async (u: string) => { calls.push(u); return { post: { url: "https://different.example", kind: "post", text: "Bài thật" } }; });
  const { result, checkpoints } = await obtain(brief(), config, dep);
  assert.equal(result.path, "facebook_post"); assert.equal(result.post?.url, url); assert.equal(checkpoints[0].state, "reserved");
  await obtain(brief(), config, dep, true, result);
  await obtain(brief(), config, dep, true, checkpoints[0]);
  assert.deepEqual(calls, [url]);
});
test("nhạy cảm/không link/tắt/hết ngân sách tuyệt đối không gọi Apify", async () => {
  let calls = 0; const dep = deps(async () => { calls++; throw Error("must not call"); });
  const cases = [
    obtain({ ...brief(), sensitive: true }, config, dep),
    obtain({ ...brief(), facebookCandidates: [] }, config, dep),
    obtain(brief(), { ...config, apifyEnabled: false }, dep),
    obtain(brief(), config, { ...dep, budget: async () => ({ ok: false, runsLeft: 0, resultsLeft: 0 }) }),
    obtain(brief(), config, dep, false),
  ];
  for (const c of cases) { const { result } = await c; assert.equal(result.path, "brief_only"); assert.ok(result.reason); }
  assert.equal(calls, 0);
});
test("quota, bài riêng tư và lỗi đều fallback brief với lý do", async () => {
  assert.match((await obtain(brief(), config, deps(async () => ({ warning: "monthly usage hard limit" })))).result.reason, /hết hạn mức/);
  assert.match((await obtain(brief(), config, deps(async () => { throw Error("private"); }))).result.reason, /riêng tư/);
});
test("service bóc bài dùng caption + đọc ảnh + nguồn ngữ cảnh, không brief giả làm bài", async () => {
  let prompt = ""; let read = 0;
  const result = await structureFetchedPost({ url, kind: "image", text: "Nội dung bài Facebook thật dài để phân tích cấu trúc một bài đã lan truyền.", thumbnailUrl: "https://images.example.com/a" }, {
    read: async () => { read++; return { textInImage: "CHỮ ẢNH THẬT", description: "Ảnh", technique: "Tương phản", imageKind: "meme", carriesMainContent: true }; },
    generate: async p => { prompt = p; return JSON.stringify({ formula: "Công thức bài thật" }); }, context: "https://news.example.com/a",
  });
  assert.equal(read, 1); assert.match(prompt, /Nội dung bài Facebook thật/); assert.match(prompt, /CHỮ ẢNH THẬT/); assert.match(prompt, /news.example.com/);
  assert.equal(result.fields.platform, "facebook"); assert.equal(result.structure?.formula, "Công thức bài thật");
});
test("job mặc định chờ Claude, không gọi Gemini; quá 90 phút RSS chưa xác minh", async () => {
  const { db, tables } = mockDb(); let calls = 0;
  const cfg = normalizeSettings({ enabled: true });
  const opts = { db, config: cfg, dryRun: true, reason: "test", queuedRunId: undefined as string | undefined, deps: { trends: async () => [{ title: "Máy tính", news: [] }], research: async () => { calls++; throw Error("Gemini forbidden"); } } };
  const first: any = await runTrendWorkflow(opts);
  assert.equal(tables.trend_workflow_items[0].status, "awaiting_research"); assert.equal(calls, 0);
  tables.trend_workflow_items[0].createdAt = new Date(Date.now() - 91 * 60_000);
  await runTrendWorkflow({ ...opts, queuedRunId: first.runId });
  assert.equal(calls, 0); assert.equal(tables.trend_workflow_items[0].brief.confidence, "unverified"); assert.match(tables.trend_workflow_items[0].brief.reason, /Claude chưa nghiên cứu/);
});

test("workflow nghiên cứu đã nộp → bài thật/remake hoặc brief fallback; retry không fetch lại", async () => {
  for (const scenario of ["post", "no_link", "disabled", "budget", "quota", "sensitive"]) {
    const b = scenario === "sensitive" ? { ...brief(), sensitive: true } : scenario === "no_link" ? { ...brief(), facebookCandidates: [] } : brief();
    const { db, tables } = mockDb({
      trend_workflow_runs: [{ id: "run", slot: "dry:submitted", dryRun: true, status: "partial", modelCalls: 0, apifyPosts: 0, maxModelCalls: 20, createdAt: new Date() }],
      trend_workflow_items: [{ id: "item", runId: "run", inputKey: "may tinh", title: "Máy tính", input: { title: "Máy tính", news: [] }, brief: b, attempts: 0, status: "researched", createdAt: new Date() }],
      brands: [{ id: "brand", name: "Test" }], brand_fanpages: [{ id: "page", brandId: "brand", pageName: "Test page", pageUrl: "https://facebook.com/test" }],
    });
    let fetches = 0; let postStructures = 0; let briefStructures = 0; let failWrite = scenario === "post";
    const cfg = normalizeSettings({ targets: [{ brandId: "brand", fanpageId: "page" }], apifyEnabled: scenario !== "disabled", maxApifyPosts: scenario === "budget" ? 0 : 3 });
    const opts = { db, config: cfg, queuedRunId: "run", dryRun: true, reason: "test", deps: {
      pageCharacters: async () => [],
      facebook: deps(async (u: string) => { fetches++; assert.equal(u, url); return scenario === "quota" ? { warning: "not-enough-usage" } : { post: { url: u, kind: "post", text: "Nội dung gốc bài Facebook đủ dài để phân tích cách triển khai." } }; }),
      postStructure: async (post: any) => { postStructures++; assert.match(post.text, /Nội dung gốc/); return { structure: { formula: "post formula" }, fields: { platform: "facebook", bodyText: post.text, structure: { formula: "post formula" } } } as any; },
      structure: async () => { briefStructures++; return { structure: { formula: "brief formula" } }; },
      write: async () => { if (failWrite) throw Error("interrupted after post cached"); return { draft: { body: "Bản nháp" } }; }, concepts: async () => {},
    } };
    await runTrendWorkflow(opts);
    if (scenario === "post") {
      assert.equal(tables.trend_workflow_items[0].status, "error");
      failWrite = false; tables.trend_workflow_items[0].lastAttemptSlot = null;
      await runTrendWorkflow(opts);
      assert.equal(fetches, 1); assert.equal(postStructures, 1); assert.equal(briefStructures, 0);
      assert.equal(tables.deconstructions[0].platform, "facebook"); assert.equal(tables.remakes[0].sourceUrl, url);
      assert.equal(tables.trend_workflow_items[0].contentPath, "facebook_post");
    } else if (scenario === "sensitive") {
      assert.equal(fetches, 0); assert.equal(postStructures, 0); assert.equal(tables.trend_workflow_items[0].status, "excluded"); continue;
    } else {
      assert.equal(fetches, scenario === "quota" ? 1 : 0); assert.equal(briefStructures, 1);
      assert.equal(tables.trend_workflow_items[0].contentPath, "brief_only"); assert.ok(tables.trend_workflow_items[0].facebookReason);
    }
    assert.equal(tables.trend_workflow_items[0].status, "done", scenario); assert.equal(tables.remakes.length, 1);
  }
});

test("submit va chạm scheduler: lưu trước, không làm run lỗi, nộp trùng idempotent và worker xử lý sau", async () => {
  const { submitTrendResearch } = await import("../services/trend-claude");
  const itemId = "11111111-1111-4111-8111-111111111111";
  const { db, tables } = mockDb({
    trend_workflow_runs: [{ id: "run", slot: "2026-11-03T08:00+07:00", dryRun: false, status: "running", modelCalls: 0, apifyPosts: 0, maxModelCalls: 20, createdAt: new Date() }],
    trend_workflow_items: [{ id: itemId, runId: "run", inputKey: "may tinh", title: "Máy tính", input: { title: "Máy tính", news: [] }, attempts: 0, status: "awaiting_research", brief: null, createdAt: new Date() }],
    trend_workflow_lease: [{ key: "default", token: "scheduler", generation: 7, expiresAt: new Date(Date.now() + 60_000) }],
  });
  const dispatched: any[] = [];
  const first = await submitTrendResearch(itemId, input, "claude", db, run => dispatched.push(run));
  assert.equal(first.status, "accepted");
  assert.equal(tables.trend_workflow_items[0].status, "researched");
  assert.equal(tables.trend_workflow_lease[0].token, "scheduler");
  assert.equal(tables.trend_workflow_runs[0].status, "partial");
  const savedBrief = tables.trend_workflow_items[0].brief;
  assert.equal((await submitTrendResearch(itemId, input, "claude", db, run => dispatched.push(run))).status, "accepted");
  assert.equal(tables.trend_workflow_items[0].brief, savedBrief);
  await assert.rejects(submitTrendResearch(itemId, { ...input, summary: "Khác" }, "claude", db), /không ghi đè/);

  const cfg = normalizeSettings({ enabled: true });
  const now = new Date("2026-11-03T01:00:00Z");
  const busy: any = await runTrendWorkflow({ db, config: cfg, now, queuedRunId: "run", reason: "dispatch", deps: { trends: async () => [] } });
  assert.equal(busy.ran, false); assert.notEqual(tables.trend_workflow_runs[0].status, "error");
  assert.equal(tables.trend_workflow_items[0].status, "researched");
  tables.trend_workflow_lease[0].expiresAt = new Date(0);
  await runTrendWorkflow({ db, config: cfg, now, reason: "scheduler", deps: { trends: async () => [] } });
  assert.equal(tables.trend_workflow_items[0].brief.provider, "claude_mcp");
  assert.equal(tables.trend_workflow_items[0].status, "brief_only");
  assert.equal(dispatched.length, 2);
});
test("scheduler đang dựng RSS fallback không ghi đè nghiên cứu Claude vừa lưu", async () => {
  const { submitTrendResearch } = await import("../services/trend-claude");
  const itemId = "22222222-2222-4222-8222-222222222222";
  const { db, tables } = mockDb({ trend_workflow_items: [{ id: itemId, runId: "run", inputKey: "x", title: "Máy tính", input: { title: "Máy tính", news: [] }, attempts: 0, status: "awaiting_research", brief: null, createdAt: new Date(Date.now() - 91 * 60_000) }],
    trend_workflow_runs: [{ id: "run", slot: "dry:race", dryRun: true, status: "partial", modelCalls: 0, apifyPosts: 0, maxModelCalls: 20, createdAt: new Date() }] });
  let submitted = false;
  const originalTransaction = db.transaction;
  db.transaction = async (fn: any) => {
    // Đúng lúc worker đã tính RSS (attempt đã tăng) nhưng chưa ghi brief.
    if (!submitted && tables.trend_workflow_items[0].attempts === 1 && !tables.trend_workflow_items[0].brief) {
      submitted = true;
      await submitTrendResearch(itemId, input, "claude", { ...db, transaction: originalTransaction }, () => {});
    }
    return originalTransaction(fn);
  };
  await runTrendWorkflow({ db, config: normalizeSettings({}), dryRun: true, queuedRunId: "run", reason: "race", deps: { trends: async () => [] } });
  assert.equal(submitted, true);
  assert.equal(tables.trend_workflow_items[0].brief.provider, "claude_mcp");
});
