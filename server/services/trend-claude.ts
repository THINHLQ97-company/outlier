import { createHash } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "../db/client";
import { trendWorkflowDrafts, trendWorkflowItems, trendWorkflowRuns } from "../db/schema";
import { assertPublicUrl } from "./brand-ingest";
import { facebookPostUrl } from "./trend-facebook-url";
import { sensitiveTrend, safetyBrief, type TrendBrief, type FacebookCandidate, eventFingerprint } from "./trend-research";

export interface ClaudeResearchInput {
  summary: string; claims: { text: string; urls: string[] }[];
  confidence?: "sourced" | "unverified"; suggestedAngle?: string;
  facebookCandidates?: { url: string; reason: string }[];
}
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
  const sources = [...new Set(claims.flatMap(c => c.urls))].map(url => ({ title: "Nguồn Claude dẫn", url }));
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
export async function trendResearchQueue(db: any = getDb()) {
  const rows = await db.select().from(trendWorkflowItems).where(eq(trendWorkflowItems.status, "awaiting_research")).orderBy(desc(trendWorkflowItems.createdAt)).limit(30);
  // Sự kiện đã biết được gộp trong workflow. Với từ khoá chưa nghiên cứu chỉ gộp
  // inputKey, không giả vờ biết hai từ khoá khác nhau là cùng một sự kiện.
  const seen = new Set<string>();
  return { items: rows.filter((r: any) => { if (seen.has(r.inputKey)) return false; seen.add(r.inputKey); return true; }).map((r: any) => ({
    itemId: r.id, keyword: r.title, traffic: r.input?.approxTraffic, news: r.input?.news || [], createdAt: r.createdAt,
    sensitive: sensitiveTrend([r.title, ...(r.input?.news || []).map((n: any) => n.title)].join(" ")),
    instruction: "Tìm web/tin tức thật, nộp khẳng định kèm nguồn. Chỉ đưa link bài Facebook lẻ có trong nguồn; không dùng Apify tìm kiếm. Nếu nhạy cảm: không tìm/tải footage, không nêu danh tính, chỉ góc trung tính.",
  })) };
}
export async function submitTrendResearch(itemId: string, input: ClaudeResearchInput, owner: string, db: any = getDb(), dispatch: (run: { id: string; dryRun: boolean }) => void = dispatchResearchRun) {
  if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(itemId)) throw new Error("Mã item không hợp lệ.");
  if (typeof input.summary !== "string" || !input.summary.trim() || !Array.isArray(input.claims)) throw new Error("Cần tóm tắt và danh sách khẳng định kèm nguồn.");
  // Submissions are durable ingress, not a worker: no global workflow lease.
  // Row lock serializes duplicate submissions and the worker's RSS fallback.
  const run = await db.transaction(async (tx: any) => {
    const [item] = await tx.select().from(trendWorkflowItems).where(eq(trendWorkflowItems.id, itemId)).for("update");
    if (!item) throw new Error("Không tìm thấy item.");
    const brief = briefFromClaude(item.title, input, sensitiveTrend([item.title, ...(item.input?.news || []).map((n: any) => n.title)].join(" ")));
    const submissionHash = createHash("sha256").update(JSON.stringify(brief)).digest("hex");
    if (item.brief?.submissionHash !== submissionHash) {
      if (item.status !== "awaiting_research") throw new Error("Item không còn chờ nghiên cứu; không ghi đè kết quả đã xử lý.");
      const saved = await tx.update(trendWorkflowItems).set({ brief: { ...brief, submittedBy: owner, submissionHash }, eventKey: eventFingerprint(brief), status: "researched", checkpoint: "researched", updatedAt: new Date() }).where(and(eq(trendWorkflowItems.id, itemId), eq(trendWorkflowItems.status, "awaiting_research"))).returning();
      if (!saved.length) throw new Error("Item đã thay đổi; hãy đọc lại trạng thái trước khi nộp.");
    }
    await tx.update(trendWorkflowRuns).set({ status: "partial", updatedAt: new Date() }).where(eq(trendWorkflowRuns.id, item.runId));
    const [parent] = await tx.select().from(trendWorkflowRuns).where(eq(trendWorkflowRuns.id, item.runId));
    return { id: item.runId as string, dryRun: Boolean(parent?.dryRun) };
  });
  // Dispatch is only a latency optimization. Scheduler also recovers researched
  // rows, so a busy lease/restart cannot discard an already accepted submission.
  try { dispatch(run); } catch { console.warn("[trend] Đã lưu nghiên cứu; scheduler sẽ tiếp tục xử lý."); }
  return { itemId, status: "accepted", message: "Đã lưu nghiên cứu. Bản nháp sẽ được xử lý khi worker rảnh; xem trend_status." };
}
function dispatchResearchRun(run: { id: string; dryRun: boolean }) {
  setImmediate(() => void import("./trend-workflow").then(m => m.runTrendWorkflow({ reason: "Claude nộp nghiên cứu", queuedRunId: run.id, dryRun: run.dryRun })).catch(e => console.warn("[trend] Chưa xử lý nghiên cứu:", e?.message)));
}
export async function trendResearchStatus(itemId: string, db: any = getDb()) {
  const [item] = await db.select().from(trendWorkflowItems).where(eq(trendWorkflowItems.id, itemId));
  if (!item) throw new Error("Không tìm thấy item.");
  const drafts = await db.select().from(trendWorkflowDrafts).where(eq(trendWorkflowDrafts.itemId, itemId));
  const { facebook, input, ...publicItem } = item;
  return { ...publicItem, drafts };
}
