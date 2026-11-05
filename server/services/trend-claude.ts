import { randomUUID, createHash } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { getDb } from "../db/client";
import { trendWorkflowDrafts, trendWorkflowItems, trendWorkflowRuns, trendWorkflowLease } from "../db/schema";
import { readTrendSettings, type TrendSettings } from "./trend-workflow-settings";
import { assertPublicUrl } from "./brand-ingest";
import { facebookPostUrl } from "./trend-facebook-url";
import { sensitiveTrend, safetyBrief, type TrendBrief, type FacebookCandidate, eventFingerprint, normalizeTrend, sameEvent } from "./trend-research";

const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
export async function trendRefreshState(db: any = getDb(), dryRun = false) {
  const [row] = await db.select().from(trendWorkflowLease).where(eq(trendWorkflowLease.key, dryRun ? "trend-rss-refresh-dry" : "trend-rss-refresh"));
  return { lastRefreshAt: row?.expiresAt || null, refreshedBy: row?.token || null };
}

export interface ClaudeResearchInput {
  summary: string; claims: { text: string; urls: string[] }[];
  confidence?: "sourced" | "unverified"; suggestedAngle?: string;
  facebookCandidates?: { url: string; reason: string }[];
  /** Optional metadata for URLs already used in claims; never a source by itself. */
  sources?: { url: string; title?: string; publisher?: string; publishedAt?: string }[];
  /** Editorial call: sourced evidence alone never means worth pursuing. */
  decision?: "pursue" | "watch" | "skip"; rationale?: string;
  pageAngles?: { fanpageId?: string; pageName?: string; angle: string }[];
  avoid?: string[];
}
const DECISIONS = ["pursue", "watch", "skip"] as const;
/** Validates the explicit decision; legacy submissions without it become watch (no draft/Teams). */
export function editorialDecision(input: ClaudeResearchInput) {
  if (input.decision !== undefined && !DECISIONS.includes(input.decision as any)) throw new Error("decision phải là pursue, watch hoặc skip.");
  const decision = input.decision || "watch";
  const rationale = text(input.rationale, 1500);
  if (decision !== "watch" && !rationale) throw new Error("Cần rationale khi decision là pursue hoặc skip.");
  const pageAngles = (Array.isArray(input.pageAngles) ? input.pageAngles : []).slice(0, 8).flatMap(a => {
    const angle = text(a?.angle, 500);
    if (!angle) return [];
    const fanpageId = typeof a.fanpageId === "string" && UUID.test(a.fanpageId) ? a.fanpageId : undefined;
    const pageName = text(a.pageName, 120);
    return [{ angle, ...(fanpageId ? { fanpageId } : {}), ...(pageName ? { pageName } : {}) }];
  });
  if (decision === "pursue" && !pageAngles.length && !text(input.suggestedAngle, 1500)) throw new Error("decision=pursue cần ít nhất một góc nội dung (pageAngles hoặc suggestedAngle).");
  const avoid = (Array.isArray(input.avoid) ? input.avoid : []).flatMap(x => { const t = text(x, 300); return t ? [t] : []; }).slice(0, 6);
  return { decision, decisionRationale: rationale, pageAngles, ...(avoid.length ? { avoid } : {}) };
}
const text = (v: unknown, max: number) => typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;
function sourceDate(v: unknown) {
  const raw = text(v, 40);
  return raw && /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+(?:Z|[+-]\d{2}:\d{2})?)?$/.test(raw) && !Number.isNaN(Date.parse(raw)) ? raw : undefined;
}
function sourceHost(url: string) { const u = new URL(url); return `${u.hostname.replace(/^www\./, "")}${u.pathname === "/" ? "" : u.pathname}`.slice(0, 200); }
export function claudePublicUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 4096) return null;
  try { const u = assertPublicUrl(raw); if (u.username || u.password) return null; u.hash = ""; return u.toString(); } catch { return null; }
}
/** Claude is an authenticated submitter, NOT an oracle: source syntax is validated,
 * not truth. Facebook candidates must be one concrete public post; cited links are ranked
 * first. Server cannot prove Claude saw them, so Apify failure falls back safely. No web fetch/search is performed by this endpoint.
 */
export function briefFromClaude(title: string, input: ClaudeResearchInput, sensitive = false): TrendBrief {
  if (sensitive || sensitiveTrend(title) || sensitiveTrend(input.summary || "") || (input.claims || []).some(c => sensitiveTrend(c.text || ""))) return safetyBrief();
  const claims = (Array.isArray(input.claims) ? input.claims : []).slice(0, 12).flatMap(c => {
    const urls = [...new Set((Array.isArray(c.urls) ? c.urls : []).slice(0, 6).map(claudePublicUrl).filter((x): x is string => !!x))];
    return typeof c.text === "string" && urls.length ? [{ text: c.text.slice(0, 1000), urls }] : [];
  });
  const meta = new Map<string, { title?: string; publisher?: string; publishedAt?: string }>();
  for (const m of (Array.isArray(input.sources) ? input.sources : []).slice(0, 30)) {
    const url = claudePublicUrl(m?.url);
    if (url && !meta.has(url)) meta.set(url, { title: text(m.title, 300), publisher: text(m.publisher, 120), publishedAt: sourceDate(m.publishedAt) });
  }
  // Metadata attaches only to an exact cited URL; unknown fields stay absent, not invented.
  const sources = [...new Set(claims.flatMap(c => c.urls))].map(url => {
    const m = meta.get(url) || {};
    return { url, title: m.title || sourceHost(url), ...(m.publisher ? { publisher: m.publisher } : {}), ...(m.publishedAt ? { publishedAt: m.publishedAt } : {}) };
  });
  const candidates: FacebookCandidate[] = (Array.isArray(input.facebookCandidates) ? input.facebookCandidates : []).slice(0, 5).map(c => {
    const publicUrl = claudePublicUrl(c.url);
    const url = publicUrl && facebookPostUrl(publicUrl);
    const cited = !!url && sources.some(s => facebookPostUrl(s.url) === url);
    return { url: url || publicUrl || "", reason: String(c.reason || "").slice(0, 500), accepted: !!url, cited, sourceUrl: publicUrl || undefined,
      ...(!publicUrl ? { rejection: "Không phải link http(s) công khai." } : !url ? { rejection: "Link trang, hồ sơ, nhóm hoặc không phải một bài Facebook cụ thể." } : {}) };
  }).sort((a, b) => Number(b.accepted && b.cited) - Number(a.accepted && a.cited));
  const sourced = claims.length > 0 && input.confidence === "sourced";
  return { title, provider: "claude_mcp", confidence: sourced ? "sourced" : "unverified", claims, sources,
    summary: String(input.summary || "").slice(0, 6000), suggestedAngle: String(input.suggestedAngle || "").slice(0, 1500),
    sensitive: false, needsReview: true, label: sourced ? "Nghiên cứu bởi Claude — cần duyệt" : "Nghiên cứu bởi Claude — chưa xác minh", facebookCandidates: candidates,
    ...(!sourced ? { reason: "Chưa có đủ khẳng định với URL nguồn để xác minh." } : {}) };
}
export async function trendResearchQueue(db: any = getDb(), config?: TrendSettings) {
  config ||= await readTrendSettings();
  const { lastRefreshAt } = await trendRefreshState(db);
  const rows = await db.select().from(trendWorkflowItems).where(and(eq(trendWorkflowItems.status, "awaiting_research"), isNull(trendWorkflowItems.deletedAt))).orderBy(desc(trendWorkflowItems.createdAt)).limit(30);
  const processing = rows.length ? 0 : (await db.select().from(trendWorkflowItems).where(and(inArray(trendWorkflowItems.status, ["researched", "pending"]), isNull(trendWorkflowItems.deletedAt)))).length;
  // Sự kiện đã biết được gộp trong workflow. Với từ khoá chưa nghiên cứu chỉ gộp
  // inputKey, không giả vờ biết hai từ khoá khác nhau là cùng một sự kiện.
  const seen = new Set<string>();
  return { lastRefreshAt, enabled: config.enabled,
    reasonIfEmpty: rows.length ? null : !config.enabled ? "Trend chủ động đang tắt." : !lastRefreshAt ? "Chưa lấy trend lần nào — hãy gọi trend_refresh trước." : `Đã lấy lúc ${new Date(lastRefreshAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}, mọi trend đều đã được nghiên cứu hoặc bỏ qua${processing ? `; ${processing} trend đang được Outlier xử lý` : ""}. Có thể gọi trend_refresh (sau thời gian chờ) hoặc tự tìm sự kiện và nộp qua trend_discover.`,
    items: rows.filter((r: any) => { if (seen.has(r.inputKey)) return false; seen.add(r.inputKey); return true; }).map((r: any) => ({
    itemId: r.id, keyword: r.title, traffic: r.input?.approxTraffic, news: r.input?.news || [], createdAt: r.createdAt,
    sensitive: sensitiveTrend([r.title, ...(r.input?.news || []).map((n: any) => n.title)].join(" ")),
    instruction: "Không bắt buộc xử lý: traffic chỉ là tín hiệu tìm kiếm, không chứng minh viral. Đánh giá tính mới, bằng chứng cộng đồng hưởng ứng và góc hợp từng trang; nộp kèm decision pursue|watch|skip + rationale (sourced chỉ là mức bằng chứng, không phải đáng làm); không có góc thì trend_skip kèm lý do. Tìm web/tin tức thật, nộp khẳng định kèm nguồn. Chỉ đưa link bài Facebook lẻ có trong nguồn; không dùng Apify tìm kiếm. Nếu nhạy cảm: không tìm/tải footage, không nêu danh tính, chỉ góc trung tính.",
  })) };
}
/** Claude-found event outside Google Trends. Creates the same item then reuses submit. */
export async function discoverTrend(input: ClaudeResearchInput & { title: string; keyword?: string }, owner: string, db: any = getDb(), config?: TrendSettings, dispatch?: (run: { id: string; dryRun: boolean }) => void) {
  config ||= await readTrendSettings();
  if (!config.enabled) return { status: "disabled", message: "Trend chủ động đang tắt; không nhận trend mới." };
  const title = text(input.title, 300);
  if (!title || typeof input.summary !== "string" || !input.summary.trim() || !Array.isArray(input.claims)) throw new Error("Cần title, tóm tắt và danh sách khẳng định kèm nguồn.");
  const inputKey = normalizeTrend(input.keyword || title).slice(0, 200);
  if (!inputKey) throw new Error("Tiêu đề trend không hợp lệ.");
  editorialDecision(input);
  const preview = briefFromClaude(title, input);
  if (!preview.sensitive && !preview.claims.length) throw new Error("Cần ít nhất một khẳng định kèm URL công khai; không tạo trend không nguồn.");
  const now = Date.now();
  const { acquireTrendLease, assertTrendFence, releaseTrendLease } = await import("./trend-workflow");
  const token = randomUUID();
  const generation = await acquireTrendLease(token, db);
  if (!generation) return { status: "busy", message: "Đang có lượt khác chạy, thử lại sau." };
  try {
    const created = await db.transaction(async (tx: any) => {
      await assertTrendFence(tx, token, generation);
      const recent = await tx.select().from(trendWorkflowItems).where(gte(trendWorkflowItems.createdAt, new Date(now - 48 * 3600_000)));
      const pending = await tx.select().from(trendWorkflowItems).where(inArray(trendWorkflowItems.status, ["awaiting_research", "researched", "pending"]));
      const existing = [...recent, ...pending].find((r: any) => r.inputKey === inputKey || (r.eventKey && r.eventKey === eventFingerprint(preview)) || (r.brief && sameEvent(preview, r.brief)));
      if (existing) return { existing };
      const day = new Date(now + 7 * 3600_000).toISOString().slice(0, 10);
      // Discovery has the same maxTrends admission cap per 30-minute ingress window.
      const today = recent.filter((r: any) => r.input?.origin === "claude_discover" && new Date(r.createdAt).getTime() >= now - 30 * 60_000).length;
      if (today >= config!.maxTrends) return { capped: true };
      const slot = `discover:${day}`;
      await tx.insert(trendWorkflowRuns).values({ slot, owner: "claude", status: "partial", maxModelCalls: config!.maxModelCalls, dryRun: false }).onConflictDoNothing();
      const [run] = await tx.select().from(trendWorkflowRuns).where(eq(trendWorkflowRuns.slot, slot));
      const [item] = await tx.insert(trendWorkflowItems).values({ runId: run.id, inputKey, title, status: "awaiting_research", checkpoint: "awaiting_research",
        input: { title, origin: "claude_discover", discoveredBy: owner, news: [] } }).onConflictDoNothing().returning();
      const submitted: any = item ? await submitTrendResearch(item.id, input, owner, tx, () => {}) : null;
      return { item, run, submitted };
    });
    if (created.capped) return { status: "capped", message: `Đã đạt trần ${config.maxTrends} trend tự tìm trong 30 phút; chưa tạo thêm.` };
    if (created.existing) return { status: "duplicate", itemId: created.existing.id, itemStatus: created.existing.status, message: "Sự kiện này đã có trong 48 giờ qua; dùng trend_status, không tạo lại." };
    if (!created.item) throw new Error("Không tạo được trend; thử lại.");
    if (created.submitted?.itemStatus !== "researched") return { ...created.submitted, itemId: created.item.id };
    try { (dispatch || dispatchResearchRun)({ id: created.run.id, dryRun: false }); } catch { console.warn("[trend] Đã lưu discovery; worker sẽ xử lý sau."); }
    return { itemId: created.item.id, status: "accepted", itemStatus: "researched", decision: "pursue", message: "Đã tạo trend từ nguồn Claude tìm và lưu nghiên cứu; Outlier sẽ lấy bài (nếu có link Facebook cụ thể) và dựng bản nháp." };
  } finally { await releaseTrendLease(token, db).catch(() => {}); }
}
/** Claude marks an RSS/queue item as not worth doing; dedupe window is bounded, no permanent topic blacklist. */
export async function skipTrend(itemId: string, reason: string, owner: string, db: any = getDb()) {
  if (!UUID.test(itemId)) throw new Error("Mã item không hợp lệ.");
  const why = text(reason, 500);
  if (!why) throw new Error("Cần lý do bỏ qua.");
  const rows = await db.update(trendWorkflowItems).set({ status: "skipped", checkpoint: "skipped", error: `Claude bỏ qua: ${why}`, facebookReason: null, updatedAt: new Date() })
    .where(and(eq(trendWorkflowItems.id, itemId), eq(trendWorkflowItems.status, "awaiting_research"), isNull(trendWorkflowItems.deletedAt))).returning();
  if (!rows.length) throw new Error("Item không còn chờ nghiên cứu; không bỏ qua được.");
  return { itemId, status: "skipped", skippedBy: owner, reason: why, message: `Đã bỏ qua. trend_refresh không đưa lại từ khoá này vào hàng chờ trong 48 giờ kể từ lúc lấy (không chặn vĩnh viễn); sự kiện mới vẫn nộp được qua trend_discover.` };
}
export async function submitTrendResearch(itemId: string, input: ClaudeResearchInput, owner: string, db: any = getDb(), dispatch: (run: { id: string; dryRun: boolean }) => void = dispatchResearchRun) {
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(itemId)) throw new Error("Mã item không hợp lệ.");
  if (typeof input.summary !== "string" || !input.summary.trim() || !Array.isArray(input.claims)) throw new Error("Cần tóm tắt và danh sách khẳng định kèm nguồn.");
  // Submissions are durable ingress, not a worker: no global workflow lease.
  // Row lock serializes duplicate submissions and the worker's RSS fallback.
  const run = await db.transaction(async (tx: any) => {
    const [item] = await tx.select().from(trendWorkflowItems).where(eq(trendWorkflowItems.id, itemId)).for("update");
    if (!item || item.deletedAt) throw new Error("Không tìm thấy item.");
    const evidence = briefFromClaude(item.title, input, sensitiveTrend([item.title, ...(item.input?.news || []).map((n: any) => n.title)].join(" ")));
    const editorial = editorialDecision(input);
    // Sensitive stays on the safety path (worker excludes it); otherwise status follows Claude's call.
    const brief: TrendBrief = evidence.sensitive ? evidence : { ...evidence, ...editorial, ...(editorial.decisionRationale ? {} : { decisionRationale: undefined }) };
    const nextStatus = evidence.sensitive || editorial.decision === "pursue" ? "researched" : editorial.decision === "skip" ? "skipped" : "watch";
    const submissionHash = createHash("sha256").update(JSON.stringify(brief)).digest("hex");
    if (item.brief?.submissionHash !== submissionHash) {
      // watch can be re-decided later (e.g. community picks it up); processed items are never overwritten.
      if (!["awaiting_research", "watch"].includes(item.status)) throw new Error("Item không còn chờ nghiên cứu; không ghi đè kết quả đã xử lý.");
      const saved = await tx.update(trendWorkflowItems).set({ brief: { ...brief, submittedBy: owner, submissionHash }, eventKey: eventFingerprint(brief), status: nextStatus, checkpoint: nextStatus,
        error: nextStatus === "skipped" ? `Claude bỏ qua: ${editorial.decisionRationale}` : null, updatedAt: new Date() }).where(and(eq(trendWorkflowItems.id, itemId), inArray(trendWorkflowItems.status, ["awaiting_research", "watch"]))).returning();
      if (!saved.length) throw new Error("Item đã thay đổi; hãy đọc lại trạng thái trước khi nộp.");
    }
    await tx.update(trendWorkflowRuns).set({ status: "partial", updatedAt: new Date() }).where(eq(trendWorkflowRuns.id, item.runId));
    const [parent] = await tx.select().from(trendWorkflowRuns).where(eq(trendWorkflowRuns.id, item.runId));
    return { id: item.runId as string, dryRun: Boolean(parent?.dryRun), status: nextStatus, decision: evidence.sensitive ? null : editorial.decision };
  });
  if (run.status !== "researched") return { itemId, status: "accepted", itemStatus: run.status, decision: run.decision,
    message: run.status === "skipped" ? "Đã lưu: Claude bỏ qua trend này; không tạo bản nháp, không gửi Teams." : "Đã lưu ở trạng thái theo dõi (watch); không tạo bản nháp, không gửi Teams. Có thể nộp lại với decision=pursue khi có góc phù hợp." };
  // Dispatch is only a latency optimization. Scheduler also recovers researched
  // rows, so a busy lease/restart cannot discard an already accepted submission.
  try { dispatch(run); } catch { console.warn("[trend] Đã lưu nghiên cứu; scheduler sẽ tiếp tục xử lý."); }
  return { itemId, status: "accepted", itemStatus: "researched", decision: run.decision, message: "Đã lưu nghiên cứu. Bản nháp sẽ được xử lý khi worker rảnh; xem trend_status." };
}
function dispatchResearchRun(run: { id: string; dryRun: boolean }) {
  setImmediate(() => void import("./trend-workflow").then(m => m.runTrendWorkflow({ reason: "Claude nộp nghiên cứu", queuedRunId: run.id, dryRun: run.dryRun })).catch(e => console.warn("[trend] Chưa xử lý nghiên cứu:", e?.message)));
}
/**
 * Một bản nháp theo page cho client/Claude. ready + error = bản nháp dùng được, chỉ ý tưởng ảnh lỗi
 * (tạo lại trong trang remake); error = page đó chưa viết được nháp, không có link.
 */
export function publicTrendDraft<T extends { remakeId: string | null; status: string; error: string | null }>(d: T) {
  const ready = d.status === "ready" && !!d.remakeId;
  return { ...d, href: ready ? `/remakes?remakeId=${encodeURIComponent(d.remakeId!)}` : null,
    imageIdeas: !ready ? null : d.error ? "error" as const : "ok" as const,
    note: ready ? (d.error ? "Bản nháp sẵn sàng · Ý tưởng ảnh lỗi, tạo lại trong trang remake." : "Bản nháp sẵn sàng.") : d.status === "error" ? "Page này chưa viết được bản nháp." : "Đang soạn bản nháp." };
}
export async function trendResearchStatus(itemId: string, db: any = getDb()) {
  const [item] = await db.select().from(trendWorkflowItems).where(eq(trendWorkflowItems.id, itemId));
  if (!item || item.deletedAt) throw new Error("Không tìm thấy item.");
  const drafts = await (await import("./trend-draft-sync")).syncTrendDrafts(await db.select().from(trendWorkflowDrafts).where(eq(trendWorkflowDrafts.itemId, itemId)), db);
  const { facebook, input, ...publicItem } = item;
  const skipped = item.status === "skipped";
  return { ...publicItem, decision: skipped ? "skip" : (item.brief as any)?.decision ?? null, discoverySource: input?.origin === "claude_discover" ? "claude" : "google_trends", skipReason: skipped ? String(item.error || "").replace(/^Claude bỏ qua: /, "") || null : null, error: skipped ? null : item.error, drafts: drafts.map(publicTrendDraft) };
}
