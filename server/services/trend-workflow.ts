// Trend chủ động: checkpoint trong DB thay vì giữ tiến độ trong RAM, vì app có
// thể restart giữa một lượt dài mà không được tạo lại bản nháp hay gửi lại thẻ.
import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { getDb, isDbConfigured } from "../db/client";
import { brandFanpages, brands, deconstructions, remakes, trendWorkflowDrafts, trendWorkflowItems, trendWorkflowLease, trendWorkflowRuns } from "../db/schema";
import { fetchGoogleTrends, type GoogleTrendItem } from "./google-trends";
import { TREND_RESEARCH_INSTRUCTION, eventFingerprint, latestTrendSlot, normalizeTrend, researchTrend, sameEvent, trendSlotDue, type TrendBrief, rssBrief, sensitiveTrend } from "./trend-research";
import { readTrendSettings, type TrendSettings } from "./trend-workflow-settings";
import { buildTrendCard, drainTrendOutbox, enqueueTrendCard } from "./trend-teams";
import { createTrendModelBudget, TrendBudgetExceeded, TrendLeaseLost, workflowModelCall, type WorkflowModelCall } from "./trend-model-budget";
import { TREND_DEFAULT_DIRECTION } from "./trend-structure";

import { obtainTrendPost, facebookDeps, type FacebookCheckpoint } from "./trend-facebook";
import { structureFetchedPost } from "./fetched-post-structure";
import { readImage } from "./image-read";

const LEASE_MS = 20 * 60_000;
export interface TrendWorkflowDeps {
  pageCharacters: (brandId: string, pageId: string) => Promise<any[]>;
  facebook: typeof facebookDeps;
  postStructure: typeof structureFetchedPost;
  trends: () => Promise<GoogleTrendItem[]>;
  modelCall: WorkflowModelCall;
  research: (item: GoogleTrendItem, config: TrendSettings, invoke: ReturnType<typeof createTrendModelBudget>["invoke"]) => Promise<TrendBrief>;
  structure: (title: string, summary: string, generate: (prompt: string) => Promise<string>) => Promise<any>;
  write: (brand: any, structure: any, generate: (prompt: string) => Promise<string>) => Promise<any>;
  concepts: (remakeId: string, fanpageId: string, generate: (prompt: string) => Promise<string>, fence: (tx: any) => Promise<void>) => Promise<unknown>;
}
const defaults: TrendWorkflowDeps = {
  pageCharacters: async (brandId, pageId) => (await import("./remake-image")).charactersForBrand(brandId, pageId),
  facebook: facebookDeps, postStructure: structureFetchedPost,
  modelCall: workflowModelCall,
  trends: () => fetchGoogleTrends("VN", 10),
  research: (item, config, invoke) => process.env.GEMINI_API_KEY ? researchTrend(item, config, query => invoke(query, { tools: [{ googleSearch: {} }], systemInstruction: TREND_RESEARCH_INSTRUCTION })) : researchTrend(item, { ...config, provider: "rss" }),
  structure: async (title, summary, generate) => (await import("./trend-structure")).structureFromTrend(title, summary, generate),
  write: async (brand, structure, generate) => (await import("./remake")).writeRemake(brand, structure, "post", { direction: TREND_DEFAULT_DIRECTION }, generate),
  concepts: async (id, fanpageId, generate, beforeSave) => (await import("./remake-image")).proposeConceptsForRemake(id, 3, { fanpageId, generate, beforeSave }),
};
export async function acquireTrendLease(token: string, db: any = getDb()) {
  const r = await db.insert(trendWorkflowLease).values({ key: "default", token, expiresAt: new Date(Date.now() + LEASE_MS) })
    .onConflictDoUpdate({ target: trendWorkflowLease.key, set: { token, generation: sql`${trendWorkflowLease.generation} + 1`, expiresAt: new Date(Date.now() + LEASE_MS) }, where: lt(trendWorkflowLease.expiresAt, new Date()) }).returning();
  return r[0]?.generation ?? null;
}
async function release(token: string, db: any = getDb()) { await db.update(trendWorkflowLease).set({ expiresAt: new Date(0) }).where(and(eq(trendWorkflowLease.key, "default"), eq(trendWorkflowLease.token, token))); }
export async function assertTrendFence(tx: any, token: string, generation: number) {
  // Row lock serializes takeover with the critical write in this transaction.
  const rows = await tx.select().from(trendWorkflowLease).where(and(eq(trendWorkflowLease.key, "default"), eq(trendWorkflowLease.token, token), eq(trendWorkflowLease.generation, generation), gte(trendWorkflowLease.expiresAt, new Date()))).for("update");
  if (!rows.length) throw new TrendLeaseLost();
}
async function renew(token: string, generation: number, db: any = getDb()) {
  const r = await db.update(trendWorkflowLease).set({ expiresAt: new Date(Date.now() + LEASE_MS) }).where(and(eq(trendWorkflowLease.key, "default"), eq(trendWorkflowLease.token, token), eq(trendWorkflowLease.generation, generation), gte(trendWorkflowLease.expiresAt, new Date()))).returning();
  if (!r.length) throw new TrendLeaseLost();
}
async function consumeApifyPost(runId: string, config: TrendSettings, db: any) {
  const day = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  // Global workflow fence serializes this daily bucket across replicas. A separate
  // dated bucket is essential: a submitted/retried item may belong to yesterday.
  const key = `trend-apify-day:${day}`;
  const [bucket] = await db.select().from(trendWorkflowLease).where(eq(trendWorkflowLease.key, key));
  if ((bucket?.generation || 0) >= config.maxApifyPostsDaily) return false;
  const r = await db.update(trendWorkflowRuns).set({ apifyPosts: sql`${trendWorkflowRuns.apifyPosts} + 1` }).where(and(eq(trendWorkflowRuns.id, runId), lt(trendWorkflowRuns.apifyPosts, config.maxApifyPosts))).returning();
  if (r.length) {
    if (bucket) await db.update(trendWorkflowLease).set({ generation: sql`${trendWorkflowLease.generation} + 1` }).where(eq(trendWorkflowLease.key, key));
    else await db.insert(trendWorkflowLease).values({ key, token: "budget", generation: 1, expiresAt: new Date(`${day}T23:59:59+07:00`) });
  }
  return r.length > 0;
}
async function consumeModelCall(runId: string, config: TrendSettings, db: any) {
  const day = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  const [{ used }] = await db.select({ used: sql<number>`coalesce(sum(${trendWorkflowRuns.modelCalls}),0)::int` }).from(trendWorkflowRuns).where(gte(trendWorkflowRuns.createdAt, new Date(`${day}T00:00:00+07:00`)));
  if (used >= config.maxModelCallsDaily) return false;
  const r = await db.update(trendWorkflowRuns).set({ modelCalls: sql`${trendWorkflowRuns.modelCalls} + 1`, updatedAt: new Date() })
    .where(and(eq(trendWorkflowRuns.id, runId), lt(trendWorkflowRuns.modelCalls, trendWorkflowRuns.maxModelCalls))).returning();
  return r.length > 0;
}
/** Brief for exactly one target page: no sibling page voice/characters leak in. */
export function trendPageBrief(brandBrief: string, page: { pageName?: string | null; pageUrl: string; audienceNote?: string | null; note?: string | null; topics?: string[] | null }, chars: { name: string; promptDescription?: string | null }[]) {
  return [brandBrief, "", "## Trang đích của bản nháp này",
    `- Viết cho riêng trang: ${page.pageName || page.pageUrl}`,
    `- Người đọc riêng của trang: ${page.audienceNote || "Chưa có dữ liệu"}`,
    `- Ghi chú giọng/nhân vật của trang: ${page.note || "Chưa có dữ liệu"}`,
    `- Chủ đề trang: ${(page.topics || []).join(", ") || "Chưa có dữ liệu"}`,
    `- Nhân vật được dùng: ${chars.length ? chars.map(c => c.name).join(", ") : "Trang chưa gán nhân vật; không mượn nhân vật trang khác"}`].join("\n");
}
export function targetsReady(config: TrendSettings) { return config.targets.length > 0; }
export async function runTrendWorkflow(opts: { db?: any; config?: TrendSettings; reason: string; dryRun?: boolean; owner?: string; now?: Date; queuedRunId?: string; deps?: Partial<TrendWorkflowDeps> }) {
  if (!opts.db && !isDbConfigured()) return { ran: false, reason: "Chưa cấu hình DATABASE_URL." };
  const config = opts.config || await readTrendSettings();
  const db: ReturnType<typeof getDb> = opts.db || getDb();
  const now = opts.now || new Date();
  const scheduledSlot = latestTrendSlot(now);
  if (!opts.dryRun && (!config.enabled || !scheduledSlot)) return { ran: false, reason: config.enabled ? "Ngoài khung chạy 08:00-22:59." : "Trend chủ động đang tắt." };
  const queued = opts.queuedRunId ? (await db.select().from(trendWorkflowRuns).where(eq(trendWorkflowRuns.id, opts.queuedRunId)))[0] : null;
  const slot = queued?.slot || (opts.dryRun ? `dry:${now.toISOString()}:${randomUUID()}` : scheduledSlot!);
  const token = randomUUID();
  const generation = await acquireTrendLease(token, db);
  if (!generation) {
    return { ran: false, reason: "Một lượt khác đang chạy." };
  }
  const deps = { ...defaults, ...opts.deps };
  // Một bước model có thể dài; gia hạn định kỳ để lease không hết giữa bước.
  let leaseError: Error | null = null;
  const fence = async (tx?: any) => {
    if (leaseError) throw new TrendLeaseLost();
    if (tx) return assertTrendFence(tx, token, generation);
    await db.transaction(t => assertTrendFence(t, token, generation));
  };
  const heartbeat = setInterval(() => void renew(token, generation, db).catch(e => { leaseError = e; console.error("[trend-workflow] Heartbeat thất bại; dừng ghi:", e?.message); }), 60_000);
  heartbeat.unref?.();
  try {
    
    await db.transaction(async tx => { await fence(tx); await tx.insert(trendWorkflowRuns).values({ slot, dryRun: Boolean(opts.dryRun), owner: opts.owner || "system", status: "running", maxModelCalls: config.maxModelCalls }).onConflictDoNothing(); });
    const [run] = await db.select().from(trendWorkflowRuns).where(eq(trendWorkflowRuns.slot, slot));
    // A submitted item from an older slot must not wait for the next slot just
    // because this slot already finished.
    const pendingResearch = !opts.dryRun && (await db.select().from(trendWorkflowItems).innerJoin(trendWorkflowRuns, eq(trendWorkflowItems.runId, trendWorkflowRuns.id)).where(and(eq(trendWorkflowItems.status, "researched"), lt(trendWorkflowItems.attempts, 3), eq(trendWorkflowRuns.dryRun, false)))).length > 0;
    if (run.status === "done" && !pendingResearch) return { ran: false, runId: run.id, reason: "Mốc này đã chạy." };
    await db.transaction(async tx => { await fence(tx); await tx.update(trendWorkflowRuns).set({ status: "running", updatedAt: new Date() }).where(eq(trendWorkflowRuns.id, run.id)); });
    let items = await db.select().from(trendWorkflowItems).where(eq(trendWorkflowItems.runId, run.id));
    if (!items.length) {
      const inputs = (await deps.trends()).slice(0, config.maxTrends);
      for (const input of inputs) await db.transaction(async tx => { await fence(tx); await tx.insert(trendWorkflowItems).values({ runId: run.id, inputKey: normalizeTrend(input.title), title: input.title, input: input as any }).onConflictDoNothing(); });
      items = await db.select().from(trendWorkflowItems).where(eq(trendWorkflowItems.runId, run.id));
    }
    const budget = createTrendModelBudget(config, () => db.transaction(async tx => { await fence(tx); return consumeModelCall(run.id, config, tx); }), () => fence(), deps.modelCall);
    // Chỉ retry ở mốc kế tiếp; không đụng item đã hoàn tất, tối đa 3 attempts.
    if (!opts.dryRun) {
      const previous = await db.select().from(trendWorkflowItems).innerJoin(trendWorkflowRuns, eq(trendWorkflowItems.runId, trendWorkflowRuns.id)).where(and(inArray(trendWorkflowItems.status, ["error", "budget_exhausted", "pending", "researched", "awaiting_research"]), lt(trendWorkflowItems.attempts, 3), eq(trendWorkflowRuns.dryRun, false)));
      // Thử lại item cũ trước để item trùng ở mốc mới được gộp về bản gốc.
      items = [...previous.map(x => x.trend_workflow_items).filter(x => x.runId !== run.id && x.lastAttemptSlot !== slot), ...items];
    }
    for (const item of items) {
      await renew(token, generation, db);
      await fence();
      const [current] = await db.select().from(trendWorkflowItems).where(eq(trendWorkflowItems.id, item.id));
      if (current) Object.assign(item, current);
      if (["done", "brief_only", "duplicate", "excluded"].includes(item.status)) continue;
      // Bị gián đoạn (crash/mất lease) thì làm tiếp; chỉ item đã lỗi mới đợi mốc sau.
      if (item.attempts >= 3 || item.lastAttemptSlot === slot && ["error", "budget_exhausted"].includes(item.status)) continue;
      if (item.status === "awaiting_research" && Date.now() - new Date(item.createdAt).getTime() < 90 * 60_000) continue;
      await db.transaction(async tx => { await fence(tx); await tx.update(trendWorkflowItems).set({ attempts: sql`${trendWorkflowItems.attempts} + 1`, lastAttemptSlot: slot }).where(eq(trendWorkflowItems.id, item.id)); });
      try { budget.assertActive(); await processItem(item, config, deps, Boolean(opts.dryRun), budget, fence, db, run.id); }
      catch (e: any) {
        if (e instanceof TrendLeaseLost || leaseError) throw new TrendLeaseLost();
        await db.transaction(async tx => { await fence(tx); await tx.update(trendWorkflowItems).set({ status: e instanceof TrendBudgetExceeded ? "budget_exhausted" : "error", error: String(e?.message || e).slice(0, 500), updatedAt: new Date() }).where(eq(trendWorkflowItems.id, item.id)); });
      }
    }
    let status = "done";
    for (const runId of new Set([run.id, ...items.map(x => x.runId)])) {
      const remaining = await db.select().from(trendWorkflowItems).where(eq(trendWorkflowItems.runId, runId));
      const state = remaining.some(x => !["done", "brief_only", "duplicate", "excluded"].includes(x.status)) ? "partial" : "done";
      if (runId === run.id) status = state;
      await db.transaction(async tx => { await fence(tx); await tx.update(trendWorkflowRuns).set({ status: state, updatedAt: new Date() }).where(eq(trendWorkflowRuns.id, runId)); });
    }
    if (!opts.dryRun) await drainTrendOutbox().catch(() => console.warn("[trend-workflow] Chưa gửi được outbox Teams; sẽ thử lại sau."));
    return { ran: true, runId: run.id, slot, status };
  } catch (e: any) {
    console.error("[trend-workflow] Lượt chạy dừng:", e?.message || e);
    await db.transaction(async tx => { await assertTrendFence(tx, token, generation); await tx.update(trendWorkflowRuns).set({ status: "error", error: String(e?.message || e).slice(0, 500), updatedAt: new Date() }).where(eq(trendWorkflowRuns.slot, slot)); }).catch(() => {});
    return { ran: false, reason: e instanceof TrendLeaseLost || leaseError ? "Mất lease; lượt chạy dừng, owner mới có thể phục hồi checkpoint." : "Lượt chạy gặp lỗi; đã lưu để chạy lại an toàn." };
  } finally { clearInterval(heartbeat); await release(token, db).catch(() => {}); }
}
async function processItem(item: typeof trendWorkflowItems.$inferSelect, config: TrendSettings, deps: TrendWorkflowDeps, dryRun: boolean, budget: ReturnType<typeof createTrendModelBudget>, fence: (tx?: any) => Promise<void>, db: ReturnType<typeof getDb>, activeRunId: string) {
  const write = async (fn: (tx: any) => Promise<any>) => db.transaction(async tx => { await fence(tx); return fn(tx); });
  // Ingress may have saved research since this worker loaded its item list.
  const [fresh] = await db.select().from(trendWorkflowItems).where(eq(trendWorkflowItems.id, item.id));
  let brief = (fresh?.brief || item.brief) as TrendBrief | null;
  if (!brief) {
    if (config.researchProvider === "claude_mcp") {
      const age = Date.now() - new Date(item.createdAt).getTime();
      if (age < 90 * 60_000) {
        return write(tx => tx.update(trendWorkflowItems).set({ status: "awaiting_research", checkpoint: "awaiting_research", updatedAt: new Date() }).where(and(eq(trendWorkflowItems.id, item.id), inArray(trendWorkflowItems.status, ["pending", "awaiting_research"]))));
      }
      brief = rssBrief(item.input as GoogleTrendItem, "Claude chưa nghiên cứu sau 90 phút; chỉ có tin RSS chưa xác minh.");
      if (!brief.sensitive) brief = { ...brief, label: "Claude chưa nghiên cứu — chưa xác minh" };
    } else if (config.researchProvider === "off") brief = rssBrief(item.input as GoogleTrendItem, "Nghiên cứu tự động đang tắt.");
    else brief = await deps.research(item.input as GoogleTrendItem, config, budget.invoke);
    brief = await write(async tx => {
      const [current] = await tx.select().from(trendWorkflowItems).where(eq(trendWorkflowItems.id, item.id)).for("update");
      // Claude may have won the race while RSS/model research was in flight.
      if (current?.brief) return current.brief as TrendBrief;
      await tx.update(trendWorkflowItems).set({ brief: brief as any, eventKey: eventFingerprint(brief!), checkpoint: "researched", status: "researched", updatedAt: new Date() }).where(eq(trendWorkflowItems.id, item.id));
      return brief!;
    });
  }
  if (brief.sensitive || sensitiveTrend(item.title)) return write(tx => tx.update(trendWorkflowItems).set({ contentPath: "brief_only", facebookReason: "Trend nhạy cảm: không lấy bài, ảnh hoặc đọc chữ trong ảnh.", status: "excluded", checkpoint: "excluded", updatedAt: new Date() }).where(eq(trendWorkflowItems.id, item.id)));
  // Dry-run không báo Teams nên cũng không được chặn lượt thật sau đó vì trùng.
  const recent = await db.select().from(trendWorkflowItems).innerJoin(trendWorkflowRuns, eq(trendWorkflowItems.runId, trendWorkflowRuns.id))
    .where(and(gte(trendWorkflowItems.createdAt, new Date(Date.now() - 48 * 3600_000)), inArray(trendWorkflowItems.status, ["done", "brief_only"]), eq(trendWorkflowRuns.dryRun, false))).orderBy(desc(trendWorkflowItems.createdAt)).limit(100);
  const duplicate = recent.find(r => r.trend_workflow_items.id !== item.id && r.trend_workflow_items.brief && sameEvent(brief!, r.trend_workflow_items.brief as TrendBrief));
  if (duplicate) return write(tx => tx.update(trendWorkflowItems).set({ status: "duplicate", duplicateOf: duplicate.trend_workflow_items.id, checkpoint: "deduped", updatedAt: new Date() }).where(eq(trendWorkflowItems.id, item.id)));
  let facebook: FacebookCheckpoint | null = item.facebook as FacebookCheckpoint | null;
  if (targetsReady(config)) facebook = await obtainTrendPost(brief, config, facebook, {
    reserve: () => write(tx => consumeApifyPost(activeRunId, config, tx)), fence: () => fence(),
    save: value => write(tx => tx.update(trendWorkflowItems).set({ facebook: value as any, contentPath: value.path, facebookReason: value.reason, facebookSourceUrl: value.url || null, updatedAt: new Date() }).where(eq(trendWorkflowItems.id, item.id))),
  }, deps.facebook);
  else await write(tx => tx.update(trendWorkflowItems).set({ contentPath: "brief_only", facebookReason: "Chưa chọn trang đích; không lấy bài có phí.", updatedAt: new Date() }).where(eq(trendWorkflowItems.id, item.id)));
  const drafts: { remakeId: string; pageName: string; angle: string; status: string }[] = [];
  if (targetsReady(config)) {
    let deconId = item.deconstructionId;
    if (!deconId) {
      let postResult: Awaited<ReturnType<typeof structureFetchedPost>> | null = null;
      if (facebook?.post && facebook.path === "facebook_post") {
        postResult = await deps.postStructure(facebook.post, { generate: budget.text,
          context: brief.summary + "\n" + brief.sources.map(s => s.url).join("\n"),
          read: url => readImage(url, async (prompt, image) => (await budget.invoke({ parts: [{ inlineData: image }, { text: prompt }] }, { responseMimeType: "application/json" })).text || ""),
        });
        budget.assertActive(); await fence();
      }
      if (postResult && !postResult.structure) {
        facebook = { ...facebook!, path: "brief_only", reason: "Đã lấy bài nhưng chưa bóc được cấu trúc; dùng tóm tắt tin tức." };
        await write(tx => tx.update(trendWorkflowItems).set({ contentPath: "brief_only", facebook: facebook as any, facebookReason: facebook!.reason }).where(eq(trendWorkflowItems.id, item.id)));
      }
      const out = postResult?.structure ? postResult : await deps.structure(brief.title, brief.summary, budget.text);
      budget.assertActive();
      await fence();
      if (!out.structure) throw new Error(out.warning || "Không lên được góc khai thác.");
      const d = await write(async tx => {
      const [created] = await tx.insert(deconstructions).values({ owner: "trend-workflow", sourceUrl: facebook?.path === "facebook_post" ? facebook.url! : brief.sources[0]?.url || `trend://${encodeURIComponent(brief.title)}`, platform: "trend", contentKind: "post", status: "ready", title: brief.title, bodyText: brief.summary, structure: out.structure, analysisMode: "transcript", analyzedBy: "gemini", ...(facebook?.path === "facebook_post" ? postResult?.fields : {}) } as any).returning();
      await tx.update(trendWorkflowItems).set({ deconstructionId: created.id, checkpoint: "structured", updatedAt: new Date() }).where(eq(trendWorkflowItems.id, item.id));
      return created;
      });
      deconId = d.id;
    }
    const [decon] = await db.select().from(deconstructions).where(eq(deconstructions.id, deconId!));
    for (const target of config.targets) {
      const [existing] = await db.select().from(trendWorkflowDrafts).where(and(eq(trendWorkflowDrafts.itemId, item.id), eq(trendWorkflowDrafts.fanpageId, target.fanpageId)));
      if (existing?.status === "ready") { drafts.push(existing); continue; }
      const [brand] = await db.select().from(brands).where(eq(brands.id, target.brandId));
      const [page] = await db.select().from(brandFanpages).where(and(eq(brandFanpages.id, target.fanpageId), eq(brandFanpages.brandId, target.brandId)));
      if (!brand || !page) throw new Error("Trang đích không còn thuộc thương hiệu đã cấu hình.");
      let remake = existing ? (await db.select().from(remakes).where(eq(remakes.id, existing.remakeId)))[0] : null;
      if (!remake) {
        const chars = await deps.pageCharacters(brand.id, page.id);
        const { buildBrandBrief } = await import("./brand-brief");
        const result = await deps.write({ name: brand.name, sells: brand.sells, audience: brand.audience, toneOfVoice: brand.toneOfVoice, addressing: brand.addressing, bannedTerms: brand.bannedTerms, allowedClaims: brand.allowedClaims, brief: trendPageBrief(buildBrandBrief(brand, [page] as any, "writing"), page, chars)}, decon.structure, budget.text);
        budget.assertActive();
        await fence();
        if (!result.draft) throw new Error(result.warning || "Không viết được bản nháp.");
        remake = await write(async tx => {
          const [created] = await tx.insert(remakes).values({ owner: "trend-workflow", brandId: brand.id, deconstructionId: deconId, format: "post", status: "ready", draft: result.draft, guardrailJson: result.guardrail, sourceUrl: facebook?.path === "facebook_post" ? facebook.url : brief.sources[0]?.url || null, sourceTitle: brief.title, directionText: TREND_DEFAULT_DIRECTION }).returning();
          await tx.insert(trendWorkflowDrafts).values({ itemId: item.id, brandId: brand.id, fanpageId: page.id, remakeId: created.id, pageName: page.pageName || brand.name, angle: decon.structure?.formula || "Góc hài trung tính", status: "pending" });
          return created;
        });
      }
      if (!remake) throw new Error("Không tìm thấy bản nháp đã lưu.");
      if (!Array.isArray(remake.imageConceptsJson) || remake.imageConceptsJson.length === 0) await deps.concepts(remake.id, page.id, budget.text, fence);
      const angle = decon.structure?.formula || "Góc hài trung tính quanh chủ đề chung.";
      await write(tx => tx.insert(trendWorkflowDrafts).values({ itemId: item.id, brandId: brand.id, fanpageId: page.id, remakeId: remake.id, pageName: page.pageName || brand.name, angle, status: "ready" }).onConflictDoUpdate({ target: [trendWorkflowDrafts.itemId, trendWorkflowDrafts.fanpageId], set: { remakeId: remake.id, status: "ready", error: null } }));
      drafts.push({ remakeId: remake.id, pageName: page.pageName || brand.name, angle, status: "ready" });
    }
  }
  const status = drafts.length ? "done" : "brief_only";
  if (!dryRun) await write(tx => enqueueTrendCard(`trend-item:${item.id}`, item.id, buildTrendCard(brief!, drafts, config.publicBaseUrl, item.id, { contentPath: facebook?.path || "brief_only", facebookSourceUrl: facebook?.url, facebookReason: facebook?.reason }), tx));
  await write(tx => tx.update(trendWorkflowItems).set({ status, checkpoint: "card_queued", error: drafts.length ? null : "Chưa cấu hình trang đích; chỉ tạo brief.", updatedAt: new Date() }).where(eq(trendWorkflowItems.id, item.id)));
}
/** Persist before dispatch so status survives request/proxy lifetime. */
export async function queueTrendDryRun(owner: string) {
  const config = await readTrendSettings();
  const [run] = await getDb().insert(trendWorkflowRuns).values({ slot: `dry:${randomUUID()}`, dryRun: true, owner, status: "pending", maxModelCalls: config.maxModelCalls }).returning();
  setImmediate(() => void runTrendWorkflow({ reason: "admin chạy thử", dryRun: true, owner, queuedRunId: run.id }).catch(e => console.error("[trend-workflow] dry-run:", e?.message)));
  return { runId: run.id, status: "pending" };
}
export async function lastTrendSlot() {
  if (!isDbConfigured()) return null;
  const [r] = await getDb().select().from(trendWorkflowRuns).where(eq(trendWorkflowRuns.dryRun, false)).orderBy(desc(trendWorkflowRuns.createdAt)).limit(1);
  return r?.slot || null;
}
let timer: NodeJS.Timeout | null = null;
async function tick(reason: string) {
  try {
    const config = await readTrendSettings();
    if (config.enabled && latestTrendSlot(new Date())) await runTrendWorkflow({ reason });
    await drainTrendOutbox();
  } catch (e: any) { console.warn("[trend-workflow] Bỏ qua lượt kiểm tra:", e?.message || e); }
  finally { timer = setTimeout(() => void tick("theo lịch 2 giờ"), 5 * 60_000); timer.unref?.(); }
}
export function startTrendWorkflowJob() {
  if (timer) return;
  if (!isDbConfigured()) return console.warn("[trend-workflow] Chưa có DATABASE_URL; không bật Trend chủ động.");
  if (!process.env.GEMINI_API_KEY) console.warn("[trend-workflow] Chưa có GEMINI_API_KEY; chỉ dùng tin Google Trends và đánh dấu chưa xác minh.");
  timer = setTimeout(() => void tick("kiểm tra sau khởi động"), 60_000);
  timer.unref?.();
}
