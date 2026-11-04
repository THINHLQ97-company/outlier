import { and, eq, inArray, lte, sql, isNull } from "drizzle-orm";
import { getDb } from "../db/client";
import { trendTeamsOutbox } from "../db/schema";
import { teamsWebhook, validateTeamsWebhook, readTrendSettings } from "./trend-workflow-settings";
import type { TrendBrief } from "./trend-research";

export interface CardDraft { remakeId: string; pageName: string; angle: string; status: string; fanpageId?: string }

/** Ngân sách chữ của thẻ: đủ đọc lướt trong Teams, chi tiết xem trên Outlier. */
export const CARD_TEXT_BUDGET = 700;
const squash = (s: unknown) => typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "";
/** Cắt theo ranh giới câu; không có câu nào vừa thì cắt theo từ và thêm "…". Không bao giờ cắt giữa từ. */
export function clipText(raw: unknown, max: number): string {
  if (max <= 0) return "";
  const s = squash(raw);
  if (s.length <= max) return s;
  let out = "";
  for (const sentence of s.split(/(?<=[.!?…])\s+/)) {
    const next = out ? `${out} ${sentence}` : sentence;
    if (next.length > max) break;
    out = next;
  }
  if (out) return out;
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > 0 ? cut.slice(0, space) : cut).replace(/[\s,;:.\-–—]+$/, "")}…`;
}
/** Tên đơn vị đăng; thiếu thì hostname bỏ www. Không bao giờ trả URL. Gộp trùng, tối đa 3. */
export function cardSourceNames(sources: TrendBrief["sources"] | undefined, max = 3): string[] {
  const seen = new Map<string, string>();
  for (const src of sources || []) {
    let name = squash(src?.publisher).slice(0, 40);
    if (!name) {
      try { const u = new URL(src.url); if (!["http:", "https:"].includes(u.protocol)) continue; name = u.hostname.replace(/^www\./i, "").slice(0, 40); } catch { continue; }
    }
    const key = name.toLowerCase();
    if (name && !seen.has(key)) seen.set(key, name);
    if (seen.size >= max) break;
  }
  return [...seen.values()];
}
type Block = { type: "TextBlock"; text: string; wrap: true; size?: string; weight?: string; color?: string; isSubtle?: boolean; spacing?: string };
const block = (text: string, extra: Partial<Block> = {}): Block => ({ type: "TextBlock", text, wrap: true, ...extra });
// Teams TextBlock hiểu một phần markdown và không có escape chắc chắn: bỏ dấu đậm/code và cú pháp link khỏi chữ người dùng.
// URL trần trong tóm tắt cũng bị bỏ: thẻ không in link nguồn, chi tiết xem trên Outlier.
const md = (s: string) => s.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\(?\bhttps?:\/\/\S+/gi, "").replace(/[*`]/g, "").replace(/\s{2,}/g, " ").trim();
/** Tính cả dấu markdown và nhãn nút để ngân sách chữ luôn có dư. */
export function cardTextLength(card: ReturnType<typeof buildTrendCard>): number {
  const c = card.attachments[0].content;
  return [...c.body.map(b => b.text), ...c.actions.map(a => a.title)].join("").length;
}

/**
 * Thẻ ngắn như đồng nghiệp nhắn: chào, 1–2 câu chuyện gì, vì sao, gợi ý theo trang, nguồn (tên, không URL),
 * cảnh báo khi cần, nút xem chi tiết/mở bản nháp. Không còn dòng kỹ thuật (lượng tìm kiếm, nhãn nghiên cứu, đường dựng…).
 */
export function buildTrendCard(brief: TrendBrief, drafts: CardDraft[], baseUrl: string, itemId?: string) {
  baseUrl = baseUrl.replace(/\/+$/, "");
  const name = clipText(brief.title, 80) || "mới";
  const heading = brief.decision === "pursue" ? `Hi team, có trend “${name}” đang lên 🔥` : `Hi team, có trend “${name}” đáng để ý`;
  const pageName = (a: { fanpageId?: string; pageName?: string }) => squash(a.pageName) || drafts.find(d => a.fanpageId && d.fanpageId === a.fanpageId)?.pageName || "";
  // Ưu tiên góc Claude chọn cho từng trang; dữ liệu cũ thì lấy theo trang đích đã có bản nháp.
  const angles = (brief.pageAngles?.length
    ? brief.pageAngles.map(a => ({ page: pageName(a), angle: squash(a.angle) }))
    : drafts.map(d => ({ page: squash(d.pageName), angle: squash(d.angle) || squash(brief.suggestedAngle) })))
    .filter(a => a.page && a.angle)
    .filter((a, i, all) => all.findIndex(b => b.page.toLowerCase() === a.page.toLowerCase()) === i);
  const names = cardSourceNames(brief.sources);
  // needsReview luôn true với mọi brief Claude nên không dùng; chỉ cảnh báo khi nhạy cảm hoặc chưa xác minh nguồn.
  const warn = brief.sensitive || brief.confidence === "unverified";
  const ready = drafts.filter(d => d.status === "ready" && d.remakeId);
  const actions = !baseUrl ? [] : [
    { type: "Action.OpenUrl", title: "Xem chi tiết trên Outlier", url: `${baseUrl}/trend-radar${itemId ? `?item=${encodeURIComponent(itemId)}` : ""}` },
    ...ready.slice(0, 2).map(d => ({ type: "Action.OpenUrl", title: (ready.length > 1 ? `Mở bản nháp ${squash(d.pageName)}` : "Mở bản nháp").slice(0, 60), url: `${baseUrl}/remakes?remakeId=${encodeURIComponent(d.remakeId)}` })),
  ];
  const build = (summaryMax: number, whyMax: number, angleMax: number, pageNameMax: number) => {
    const summary = clipText(squash(brief.summary).split(/(?<=[.!?])\s+/).slice(0, 2).join(" "), summaryMax);
    const why = clipText(brief.decisionRationale, whyMax);
    const body: Block[] = [
      block(md(heading), { size: "Large", weight: "Bolder" }),
      ...(summary ? [block(md(summary))] : []),
      ...(why ? [block(`**${brief.decision === "pursue" ? "Vì sao đáng làm" : "Lý do"}:** ${md(why)}`, { spacing: "Small" })] : []),
      ...(angles.length ? [block("**Gợi ý theo trang**", { spacing: "Medium" }), ...angles.map(a => block(`• **${md(clipText(a.page, pageNameMax))}:** ${md(clipText(a.angle, angleMax))}`, { spacing: "None" }))] : []),
      ...(names.length ? [block(md(`Nguồn: ${names.join(", ")}`), { size: "Small", isSubtle: true, spacing: "Medium" })] : []),
      ...(warn ? [block("Cần duyệt kỹ trước khi đăng", { size: "Small", color: "Attention", weight: "Bolder", spacing: "Small" })] : []),
    ];
    return { type: "message", attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", content: {
      type: "AdaptiveCard", version: "1.2", $schema: "http://adaptivecards.io/schemas/adaptive-card.json", body, actions,
    } }] };
  };
  // Thu gọn dần, giữ mỗi trang có góc (hợp đồng nghiên cứu tối đa 8 trang).
  const steps: [number, number, number, number][] = [[220, 160, 120, 40], [220, 100, 70, 30], [160, 60, 40, 24], [100, 0, 25, 18], [60, 0, 12, 12]];
  let card = build(...steps[0]);
  for (const step of steps.slice(1)) {
    if (cardTextLength(card) < CARD_TEXT_BUDGET) break;
    card = build(...step);
  }
  return card;
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
