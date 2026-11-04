import { and, eq, inArray, lte, sql, isNull } from "drizzle-orm";
import { getDb } from "../db/client";
import { trendTeamsOutbox } from "../db/schema";
import { teamsWebhook, validateTeamsWebhook, readTrendSettings } from "./trend-workflow-settings";
import type { TrendBrief } from "./trend-research";

export interface CardDraft { remakeId: string; pageName: string; angle: string; status: string }
const text = (s: string) => ({ type: "TextBlock", text: s.slice(0, 3500), wrap: true });
export function buildTrendCard(brief: TrendBrief, drafts: CardDraft[], baseUrl: string, _itemId?: string, route?: { contentPath?: string | null; facebookSourceUrl?: string | null; facebookReason?: string | null }) {
  return { type: "message", attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", content: {
    type: "AdaptiveCard", version: "1.2", $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    body: [text(`Trend chủ động: ${brief.title}`), text(`Lượng tìm kiếm: ${brief.traffic || "Chưa rõ"} | ${brief.label}`),
      text(route?.contentPath === "facebook_post" ? "Dựng từ bài Facebook" : "Dựng từ tóm tắt tin tức"),
      ...(route?.facebookSourceUrl ? [text(`Bài Facebook gốc: ${route.facebookSourceUrl}`)] : []),
      ...(route?.facebookReason ? [text(route.facebookReason)] : []),
      text(brief.summary), text(brief.sensitive ? "Nhạy cảm — cần người duyệt kỹ" : "Bản nháp chưa được duyệt. Chưa vẽ ảnh, chưa đăng bài."),
      ...brief.sources.slice(0, 6).map(s => text(`${s.title}\n${s.url}`)),
      ...drafts.map(d => text(`${d.pageName}: ${d.angle} (${d.status === "ready" ? "Đã chuẩn bị bản nháp" : "Chưa chuẩn bị xong"})`)),
      ...(drafts.length ? [] : [text("Chỉ có brief: chưa cấu hình trang đích hoặc chưa đủ điều kiện viết bản nháp.")])],
    actions: baseUrl ? drafts.filter(d => d.status === "ready").slice(0, 8).map(d => ({ type: "Action.OpenUrl", title: `Mở bản nháp ${d.pageName}`.slice(0, 80), url: `${baseUrl}/remakes?remakeId=${encodeURIComponent(d.remakeId)}` })) : [],
  } }] };
}
export function retryDelay(attempts: number): number { return Math.min(3600_000, 30_000 * 2 ** Math.max(0, attempts - 1)); }
export function deliveryStatus(httpStatus: number): "accepted" | "retry" | "failed" {
  return httpStatus >= 200 && httpStatus < 300 ? "accepted" : httpStatus === 429 || httpStatus >= 500 ? "retry" : "failed";
}
export interface DeliveryOutcome { status: "accepted" | "retry" | "failed" | "unknown"; error: string | null }
export async function deliverTrendCard(webhook: string, payload: Record<string, any>, post: typeof fetch = fetch): Promise<DeliveryOutcome> {
  try {
    const res = await post(validateTeamsWebhook(webhook), { method: "POST", redirect: "error", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15_000) });
    // Không đọc/ghi response body: nó có thể chứa URL webhook kèm chữ ký bí mật.
    const status = deliveryStatus(res.status);
    return { status, error: status === "accepted" ? null : `Teams trả HTTP ${res.status}.` };
  } catch {
    // Workflow không có idempotency phía nhận. Timeout không chứng minh là chưa
    // nhận; tự retry sẽ gửi trùng. Giữ unknown để admin kiểm tra, không tự phát lại.
    return { status: "unknown", error: "Không xác định Teams đã nhận chưa. Cần kiểm tra thủ công; không tự gửi lại để tránh trùng." };
  }
}
export async function enqueueTrendCard(key: string, itemId: string, payload: Record<string, any>, db: any = getDb()) {
  return db.insert(trendTeamsOutbox).values({ idempotencyKey: key, itemId, payload }).onConflictDoNothing().returning();
}
export async function drainTrendOutbox(post: typeof fetch = fetch, onlyId?: string, deps = { db: getDb, settings: readTrendSettings, webhook: teamsWebhook }): Promise<void> {
  const db = deps.db();
  await recoverStaleTrendOutbox(db);
  const config = await deps.settings();
  const webhook = await deps.webhook();
  if ((!config.teamsEnabled && !onlyId) || !webhook || !config.publicBaseUrl) return;
  // Claim nguyên tử: hai tiến trình không cùng POST một outbox. Không tái claim
  // sending khi restart vì tiến trình cũ có thể đã gửi nhưng chưa ghi accepted.
  const candidates = await db.select().from(trendTeamsOutbox).where(and(
    inArray(trendTeamsOutbox.status, ["pending", "retry"]), lte(trendTeamsOutbox.nextAttemptAt, new Date()),
    onlyId ? eq(trendTeamsOutbox.id, onlyId) : undefined,
  )).limit(10);
  for (const row of candidates) {
    const [claimed] = await db.update(trendTeamsOutbox).set({ status: "sending", sendingAt: new Date(), attempts: sql`${trendTeamsOutbox.attempts} + 1` })
      .where(and(eq(trendTeamsOutbox.id, row.id), eq(trendTeamsOutbox.status, row.status))).returning();
    if (!claimed) continue;
    const out = await deliverTrendCard(webhook, claimed.payload, post);
    const status = out.status === "retry" && claimed.attempts >= 5 ? "failed" : out.status;
    await db.update(trendTeamsOutbox).set({ status, lastError: out.error,
      nextAttemptAt: new Date(Date.now() + retryDelay(claimed.attempts)), acceptedAt: status === "accepted" ? new Date() : null,
    }).where(and(eq(trendTeamsOutbox.id, row.id), eq(trendTeamsOutbox.status, "sending")));
  }
}

/** Unknown must never be auto-claimed: the remote may already have accepted it. */
export async function recoverStaleTrendOutbox(db: any = getDb()) {
  await db.update(trendTeamsOutbox).set({ status: "unknown", lastError: "Gửi bị gián đoạn quá 2 phút. Kiểm tra Teams, sau đó admin đánh dấu đã xử lý hoặc xác nhận gửi lại (có thể trùng)." }).where(and(eq(trendTeamsOutbox.status, "sending"), lte(trendTeamsOutbox.sendingAt, new Date(Date.now() - 120_000))));
  // Rows from pre-upgrade versions have no sending timestamp.
  await db.update(trendTeamsOutbox).set({ status: "unknown", lastError: "Lượt gửi cũ không có thời điểm gửi. Cần admin kiểm tra Teams trước khi xác nhận xử lý." }).where(and(eq(trendTeamsOutbox.status, "sending"), isNull(trendTeamsOutbox.sendingAt)));
}
export async function resolveTrendOutbox(id: string, action: "resolved" | "resend", owner: string, db: any = getDb()) {
  return db.update(trendTeamsOutbox).set({ status: action === "resend" ? "pending" : "resolved", resolvedBy: owner, resolvedAt: new Date(), nextAttemptAt: new Date(), sendingAt: null, attempts: action === "resend" ? 0 : undefined }).where(and(eq(trendTeamsOutbox.id, id), eq(trendTeamsOutbox.status, "unknown"))).returning();
}
/** DB-backed per-user rate limit, shared across replicas and restarts. */
export async function reserveTrendSendTest(owner: string, db: any = getDb()) {
  const key = `send-test:${owner}`;
  const result = await db.execute(sql`INSERT INTO trend_workflow_lease (key, token, generation, expires_at)
    VALUES (${key}, 'rate', 1, now() + interval '1 minute')
    ON CONFLICT (key) DO UPDATE SET
      generation = CASE WHEN trend_workflow_lease.expires_at <= now() THEN 1 ELSE trend_workflow_lease.generation + 1 END,
      expires_at = CASE WHEN trend_workflow_lease.expires_at <= now() THEN now() + interval '1 minute' ELSE trend_workflow_lease.expires_at END
    WHERE trend_workflow_lease.expires_at <= now() OR trend_workflow_lease.generation < 3
    RETURNING generation`);
  return result.rows.length > 0;
}
