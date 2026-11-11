import type { Express } from "express";
import { and, desc, eq, gte, inArray, isNull, isNotNull } from "drizzle-orm";
import { requireAuth as defaultAuth, requireAdmin as defaultAdmin, getAuthUser } from "../auth-mw";
import { getDb as getDefaultDb, isDbConfigured as isDefaultDbConfigured } from "../db/client";
import { brands, brandFanpages, trendWorkflowRuns, trendWorkflowItems, trendWorkflowDrafts, trendTeamsOutbox, users } from "../db/schema";
import { normalizeSettings, publicTrendSettings, readTrendSettings, saveTrendSettings, withPublicBaseFallback, teamsWebhook } from "../services/trend-workflow-settings";
import { queueTrendDryRun as defaultQueue, lastTrendSlot } from "../services/trend-workflow";
import { publicTrendDraft, trendRefreshState } from "../services/trend-claude";
import { buildTrendCard, drainTrendOutbox, recoverStaleTrendOutbox, reserveTrendSendTest, resolveTrendOutbox } from "../services/trend-teams";
import { trashTrends, restoreTrends } from "../services/trend-trash";
import { syncTrendDrafts } from "../services/trend-draft-sync";
import { sensitiveTrend, type TrendBrief } from "../services/trend-research";
/** Safe derived fields; never expose raw input. Skip reason is stored in error without a new migration. */
export function trendItemPublicFields(r: { status: string; error: string | null; input: unknown; brief?: unknown }) {
  const skipped = r.status === "skipped";
  return { decision: skipped ? "skip" as const : ((r.brief as any)?.decision ?? null) as "pursue" | "watch" | "skip" | null, discoverySource: (r.input as any)?.origin === "claude_discover" ? "claude" as const : "google_trends" as const,
    skipReason: skipped ? (r.error || "").replace(/^Claude bỏ qua: /, "") || null : null, error: skipped ? null : r.error };
}
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;

export function trendSendDecisionGuard(item: { brief: unknown }, dryRun = false) {
  if ((item.brief as any)?.decision !== "pursue") return { code: "DECISION_REQUIRED", error: "Cần Claude đánh giá lại và quyết định pursue trước khi gửi Teams." };
  if (dryRun) return { code: "DRY_RUN_ONLY", error: "Trend chạy thử không được gửi Teams. Hãy tạo lượt thật sau khi đánh giá." };
  return null;
}

/** Gửi tay: cùng cổng biên tập với thẻ tự động, nhưng KHÔNG đòi teamsEnabled hay bản nháp. */
export function trendManualSendGuard(item: { status: string; title: string; brief: unknown }, dryRun: boolean) {
  const b = item.brief as TrendBrief | null;
  if (!b) return { code: "BRIEF_NOT_FOUND", error: "Chưa có bản tóm tắt." };
  if (item.status === "excluded" || b.sensitive || sensitiveTrend(item.title)) return { code: "SENSITIVE_TREND", error: "Xu hướng nhạy cảm; không gửi Teams." };
  if (b.decision === "skip" || item.status === "skipped" || item.status === "duplicate") return { code: "DECISION_REQUIRED", error: "Trend đã bị bỏ qua hoặc đánh dấu trùng; không gửi Teams." };
  if (dryRun) return { code: "DRY_RUN_ONLY", error: "Trend chạy thử không được gửi Teams. Hãy tạo lượt thật sau khi đánh giá." };
  // Gửi tay là hành động xác nhận cuối của owner: watch vẫn gửi được khi owner
  // thấy trend phù hợp, còn auto-delivery vẫn chỉ dành cho pursue.
  return null;
}
/** Chống bấm trùng: mọi lần gửi tay của một trend trong 2 phút gần nhất coi là một. */
export const MANUAL_SEND_WINDOW_MS = 120_000;
export async function sendTestGuard(owner: string, deps = { settings: readTrendSettings, reserve: reserveTrendSendTest }) {
  // Check base URL before spending a rate-limit slot.
  if (!(await deps.settings()).publicBaseUrl) return { status: 409, code: "BASE_URL_REQUIRED", error: "Cần URL Outlier để mở bản nháp từ Teams." };
  if (!await deps.reserve(owner)) return { status: 429, code: "RATE_LIMITED", error: "Tối đa 3 lượt gửi thử hoặc gửi lại mỗi phút mỗi người." };
  return null;
}
export function registerTrendWorkflowRoutes(app: Express, overrides: Partial<{ db: typeof getDefaultDb; configured: typeof isDefaultDbConfigured; auth: typeof defaultAuth; admin: typeof defaultAdmin; queue: typeof defaultQueue; guard: typeof sendTestGuard; drain: (onlyId: string) => Promise<void>; webhook: typeof teamsWebhook; settings: typeof readTrendSettings }> = {}) {
  const { db: getDb, configured: isDbConfigured, auth: requireAuth, queue: queueTrendDryRun, guard: checkSendTest, drain: drainOne, webhook: getWebhook, settings: getSettings } = { db: () => getDefaultDb(), configured: isDefaultDbConfigured, auth: defaultAuth, queue: defaultQueue, guard: sendTestGuard,
    drain: (onlyId: string) => drainTrendOutbox(undefined, onlyId), webhook: teamsWebhook, settings: readTrendSettings, ...overrides };
  const canConfigure = async (req: any) => {
    const username = getAuthUser(req);
    if (!username) return false;
    const [user] = await getDb().select().from(users).where(eq(users.username, username));
    const configured = process.env.TREND_WORKFLOW_ADMIN_EMAILS?.trim();
    const allowed = (configured || "lamquangthinh3006@gmail.com").split(",").map(email => email.trim().toLowerCase()).filter(Boolean);
    return !!user && user.isActive && user.role === "admin" && !!user.email?.trim() && allowed.includes(user.email.trim().toLowerCase());
  };
  const requireTrendOwner = async (req: any, res: any, next: any) => {
    if (!isDbConfigured()) return res.status(503).json({ error: "Chưa cấu hình dữ liệu cho Trend chủ động." });
    try {
      if (!await canConfigure(req)) return res.status(403).json({ error: "Chỉ người quản trị tính năng này mới được cài đặt" });
      next();
    } catch { res.status(500).json({ error: "Lỗi kiểm tra quyền quản trị." }); }
  };
  // Một wrapper chung để lỗi DB không thành unhandled rejection (Express 4).
  const route = (fn: (req: any, res: any) => Promise<any>) => async (req: any, res: any) => {
    if (!isDbConfigured()) return res.status(503).json({ code: "DB_UNAVAILABLE", error: "Chưa cấu hình dữ liệu cho Trend chủ động." });
    try { await fn(req, res); }
    catch { res.status(500).json({ code: "TREND_WORKFLOW_ERROR", error: "Không thực hiện được. Vui lòng thử lại sau." }); }
  };
  app.get("/api/trend-workflow/status", requireAuth, route(async (req, res) => {
    const allowed = await canConfigure(req);
    if (allowed) await recoverStaleTrendOutbox();
    const runs = await getDb().select().from(trendWorkflowRuns).orderBy(desc(trendWorkflowRuns.createdAt)).limit(10);
    const outbox = await getDb().select({ id: trendTeamsOutbox.id, status: trendTeamsOutbox.status, attempts: trendTeamsOutbox.attempts, lastError: trendTeamsOutbox.lastError, acceptedAt: trendTeamsOutbox.acceptedAt, nextAttemptAt: trendTeamsOutbox.nextAttemptAt }).from(trendTeamsOutbox).orderBy(desc(trendTeamsOutbox.createdAt)).limit(30);
    const settings = await publicTrendSettings();
    const refresh = await trendRefreshState(getDb());
    res.json({ canConfigure: allowed, settings: { skippedRetentionDays: settings.skippedRetentionDays, enabled: settings.enabled, researchProvider: settings.researchProvider, hasTargets: settings.targets.length > 0, webhookConfigured: allowed ? settings.webhookConfigured : undefined }, lastRefreshAt: refresh.lastRefreshAt, refreshedBy: refresh.refreshedBy, lastSlot: await lastTrendSlot(), runs: runs.map(r => ({ id: r.id, status: r.status, error: r.error, createdAt: r.createdAt, dryRun: r.dryRun })), outbox: allowed ? outbox : [] });
  }));
  app.get("/api/trend-workflow/settings", requireAuth, requireTrendOwner, route(async (_req, res) => res.json(await publicTrendSettings())));
  app.put("/api/trend-workflow/settings", requireAuth, requireTrendOwner, route(async (req, res) => {
    let config;
    try { config = withPublicBaseFallback(normalizeSettings({ ...await readTrendSettings(), ...req.body }), req); }
    catch { return res.status(400).json({ code: "INVALID_RETENTION", error: "Ngày lưu trend phải là số nguyên: đã bỏ qua 1–90 ngày, trend cũ 7–365 ngày." }); }
    const pages = await getDb().select({ id: brandFanpages.id, brandId: brandFanpages.brandId }).from(brandFanpages);
    if (config.targets.some(t => !UUID.test(t.brandId) || !UUID.test(t.fanpageId) || !pages.some(p => p.id === t.fanpageId && p.brandId === t.brandId)) || new Set(config.targets.map(t => t.fanpageId)).size !== config.targets.length) {
      return res.status(400).json({ code: "INVALID_TARGET", error: "Trang đích không hợp lệ hoặc không thuộc thương hiệu đã chọn." });
    }
    if (config.enabled && config.teamsEnabled && !config.publicBaseUrl) return res.status(400).json({ code: "BASE_URL_REQUIRED", error: "Chưa xác định được địa chỉ website để tạo nút Mở bản nháp trên Teams. Hãy mở Outlier bằng địa chỉ chính thức (https) rồi lưu lại." });
    try {
      await saveTrendSettings(config, getAuthUser(req)!, typeof req.body?.teamsWebhookUrl === "string" ? req.body.teamsWebhookUrl : undefined);
    } catch { return res.status(400).json({ code: "INVALID_WEBHOOK", error: "Không lưu được webhook. Kiểm tra URL Microsoft Workflows và AUTH_SECRET trên server." }); }
    res.json(await publicTrendSettings());
  }));
  app.get("/api/trend-workflow/targets", requireAuth, requireTrendOwner, route(async (_req, res) => {
    // Select tường minh: không được mang metaTokenEnc của trang ra client.
    const bs = await getDb().select({ id: brands.id, name: brands.name }).from(brands);
    const pages = await getDb().select({ id: brandFanpages.id, brandId: brandFanpages.brandId, pageName: brandFanpages.pageName, platform: brandFanpages.platform, pageUrl: brandFanpages.pageUrl }).from(brandFanpages);
    res.json({ brands: bs, fanpages: pages });
  }));
  app.get("/api/trend-workflow/trends", requireAuth, route(async (req, res) => {
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 30));
    const offset = Math.max(0, Math.floor(Number(req.query.offset) || 0));
    const trash = req.query.trash === "1";
    if (trash && !await canConfigure(req)) return res.status(403).json({ error: "Chỉ người quản trị tính năng được mở Thùng rác." });
    const rows = await getDb().select().from(trendWorkflowItems).where(trash ? isNotNull(trendWorkflowItems.deletedAt) : isNull(trendWorkflowItems.deletedAt)).orderBy(desc(trash ? trendWorkflowItems.deletedAt : trendWorkflowItems.createdAt)).limit(limit).offset(offset);
    const total = (await getDb().select({ id: trendWorkflowItems.id }).from(trendWorkflowItems).where(trash ? isNotNull(trendWorkflowItems.deletedAt) : isNull(trendWorkflowItems.deletedAt))).length;
    const trashTotal = trash ? total : await canConfigure(req) ? (await getDb().select({ id: trendWorkflowItems.id }).from(trendWorkflowItems).where(isNotNull(trendWorkflowItems.deletedAt))).length : 0;
    const drafts = rows.length ? await syncTrendDrafts(await getDb().select().from(trendWorkflowDrafts).where(inArray(trendWorkflowDrafts.itemId, rows.map(r => r.id))), getDb()) : [];
    // Chỉ thời điểm Teams đã nhận (accepted) — không có nghĩa đã hiển thị; không lộ payload/lỗi outbox.
    const sent = rows.length ? await getDb().select({ itemId: trendTeamsOutbox.itemId, acceptedAt: trendTeamsOutbox.acceptedAt }).from(trendTeamsOutbox).where(and(inArray(trendTeamsOutbox.itemId, rows.map(r => r.id)), eq(trendTeamsOutbox.status, "accepted"))) : [];
    const lastSent = (id: string) => sent.filter(o => o.itemId === id && o.acceptedAt).map(o => new Date(o.acceptedAt!).getTime()).sort((a, b) => b - a)[0];
    const runs = rows.length ? await getDb().select({ id: trendWorkflowRuns.id, dryRun: trendWorkflowRuns.dryRun }).from(trendWorkflowRuns).where(inArray(trendWorkflowRuns.id, [...new Set(rows.map(r => r.runId))])) : [];
    res.json({ total, trashTotal, items: rows.map(r => ({ ...r, ...trendItemPublicFields(r), facebook: undefined, input: undefined, title: (r.brief as any)?.title || r.title, drafts: drafts.filter(d => d.itemId === r.id).map(publicTrendDraft),
      dryRun: Boolean(runs.find(x => x.id === r.runId)?.dryRun), teamsSentAt: lastSent(r.id) ? new Date(lastSent(r.id)!).toISOString() : null })) });
  }));
  for (const action of ["delete", "restore"] as const) app.post(`/api/trend-workflow/trends/${action}`, requireAuth, requireTrendOwner, route(async (req, res) => {
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || !ids.length || ids.length > 200 || ids.some(id => typeof id !== "string" || !UUID.test(id))) return res.status(400).json({ code: "INVALID_IDS", error: "Chọn từ 1 đến 200 trend hợp lệ." });
    const unique = [...new Set<string>(ids)];
    const count = action === "delete" ? await trashTrends(unique, getAuthUser(req)!, getDb()) : await restoreTrends(unique, getDb());
    res.json({ count });
  }));
  app.post("/api/trend-workflow/run", requireAuth, requireTrendOwner, route(async (req, res) => {
    if (req.body?.dryRun !== true) return res.status(400).json({ code: "DRY_RUN_REQUIRED", error: "Chạy thử bắt buộc dryRun=true; không gửi Teams." });
    // Có thể tốn phí model nhưng vẫn theo đúng trần đã cấu hình trong DB.
    const result: any = await queueTrendDryRun(getAuthUser(req)!);
    // Claude mode: synchronous RSS refresh only (no model, no Teams).
    res.status(result.status === "refreshed" ? 200 : 202).json(result);
  }));
  app.get("/api/trend-workflow/runs/:id", requireAuth, route(async (req, res) => {
    if (!UUID.test(req.params.id)) return res.status(400).json({ code: "INVALID_ID", error: "Mã lượt chạy không hợp lệ." });
    const [run] = await getDb().select().from(trendWorkflowRuns).where(eq(trendWorkflowRuns.id, req.params.id));
    if (!run) return res.status(404).json({ code: "RUN_NOT_FOUND", error: "Không tìm thấy lượt chạy." });
    res.json(run);
  }));
  app.post("/api/trend-workflow/outbox/:id/resolve", requireAuth, requireTrendOwner, route(async (req, res) => {
    if (!UUID.test(req.params.id)) return res.status(400).json({ code: "INVALID_ID", error: "Mã lượt gửi không hợp lệ." });
    const action = req.body?.action;
    if (req.body?.confirm !== true || !["resolved", "resend"].includes(action) || action === "resend" && req.body?.acknowledgeDuplicateRisk !== true) return res.status(400).json({ code: "CONFIRM_REQUIRED", error: "Cần xác nhận đã kiểm tra Teams; gửi lại có thể tạo thông báo trùng." });
    const blocked = action === "resend" ? await checkSendTest(getAuthUser(req)!) : null;
    if (blocked) return res.status(blocked.status).json({ code: blocked.code, error: blocked.error });
    const rows = await resolveTrendOutbox(req.params.id, action, getAuthUser(req)!);
    if (!rows.length) return res.status(409).json({ code: "OUTBOX_NOT_UNKNOWN", error: "Chỉ xử lý thủ công lượt gửi chưa xác định." });
    // Resend is explicit and shares the same atomic outbox claim as the worker.
    if (action === "resend") await drainTrendOutbox(undefined, req.params.id);
    res.json({ id: req.params.id, action });
  }));
  app.get("/api/trend-workflow/trends/:id/card", requireAuth, route(async (req, res) => {
    if (!UUID.test(req.params.id)) return res.status(400).json({ code: "INVALID_ID", error: "Mã xu hướng không hợp lệ." });
    const [row] = await getDb().select().from(trendWorkflowItems).where(and(eq(trendWorkflowItems.id, req.params.id), isNull(trendWorkflowItems.deletedAt)));
    if (!row?.brief) return res.status(404).json({ code: "BRIEF_NOT_FOUND", error: "Chưa có bản tóm tắt cho xu hướng này." });
    const drafts = await syncTrendDrafts(await getDb().select().from(trendWorkflowDrafts).where(eq(trendWorkflowDrafts.itemId, row.id)), getDb());
    res.json({ payload: buildTrendCard(row.brief as TrendBrief, drafts, (await readTrendSettings()).publicBaseUrl, row.id), sent: false });
  }));
  app.post("/api/trend-workflow/trends/:id/send-test", requireAuth, requireTrendOwner, route(async (req, res) => {
    const key = String(req.body?.idempotencyKey || "");
    if (req.body?.confirm !== true || !/^[a-zA-Z0-9_-]{8,80}$/.test(key)) return res.status(400).json({ code: "CONFIRM_REQUIRED", error: "Xác nhận gửi thử và cung cấp mã chống gửi trùng (8-80 ký tự)." });
    const blocked = await checkSendTest(getAuthUser(req)!);
    if (blocked) return res.status(blocked.status).json({ code: blocked.code, error: blocked.error });
    const config = await readTrendSettings();
    if (!await teamsWebhook()) return res.status(409).json({ code: "WEBHOOK_NOT_CONFIGURED", error: "Chưa cấu hình Workflow riêng cho Outlier." });
    if (!UUID.test(req.params.id)) return res.status(400).json({ code: "INVALID_ID", error: "Mã xu hướng không hợp lệ." });
    const [item] = await getDb().select().from(trendWorkflowItems).where(and(eq(trendWorkflowItems.id, req.params.id), isNull(trendWorkflowItems.deletedAt)));
    if (!item?.brief) return res.status(404).json({ code: "BRIEF_NOT_FOUND", error: "Chưa có bản tóm tắt." });
    if (item.status === "excluded") return res.status(409).json({ code: "SENSITIVE_TREND", error: "Xu hướng nhạy cảm đã bị loại; không gửi Teams." });
    const [parentRun] = await getDb().select().from(trendWorkflowRuns).where(eq(trendWorkflowRuns.id, item.runId));
    const decisionBlocked = trendSendDecisionGuard(item, Boolean(parentRun?.dryRun));
    if (decisionBlocked) return res.status(409).json(decisionBlocked);
    const drafts = await syncTrendDrafts(await getDb().select().from(trendWorkflowDrafts).where(eq(trendWorkflowDrafts.itemId, item.id)), getDb());
    if (!drafts.some(d => d.status === "ready")) return res.status(409).json({ code: "DRAFT_REQUIRED", error: "Cần có ít nhất một bản nháp sẵn sàng để thẻ mở được bản nháp." });
    const idempotencyKey = `test:${item.id}:${key}`;
    await getDb().insert(trendTeamsOutbox).values({ idempotencyKey, itemId: item.id, payload: buildTrendCard(item.brief as TrendBrief, drafts, config.publicBaseUrl, item.id) }).onConflictDoNothing();
    const [out] = await getDb().select().from(trendTeamsOutbox).where(eq(trendTeamsOutbox.idempotencyKey, idempotencyKey));
    await drainTrendOutbox(undefined, out.id);
    const [after] = await getDb().select().from(trendTeamsOutbox).where(eq(trendTeamsOutbox.id, out.id));
    res.json({ id: after.id, status: after.status, attempts: after.attempts, error: after.lastError, message: after.status === "accepted" ? "Teams đã nhận (chưa xác nhận đã hiển thị)." : "Đã lưu trạng thái gửi; xem lại kết quả trong outbox." });
  }));
  // Gửi thẻ thật bằng tay (owner). Dùng chung outbox/claim/drain với thẻ tự động; key riêng
  // nên không bị chặn bởi thẻ tự động đã gửi, nhưng bấm trùng trong 2 phút chỉ gửi một lần.
  app.post("/api/trend-workflow/trends/:id/send", requireAuth, requireTrendOwner, route(async (req, res) => {
    if (req.body?.confirm !== true) return res.status(400).json({ code: "CONFIRM_REQUIRED", error: "Cần xác nhận gửi thẻ lên Teams." });
    if (!UUID.test(req.params.id)) return res.status(400).json({ code: "INVALID_ID", error: "Mã xu hướng không hợp lệ." });
    const [item] = await getDb().select().from(trendWorkflowItems).where(and(eq(trendWorkflowItems.id, req.params.id), isNull(trendWorkflowItems.deletedAt)));
    if (!item?.brief) return res.status(404).json({ code: "BRIEF_NOT_FOUND", error: "Chưa có bản tóm tắt." });
    const [parentRun] = await getDb().select().from(trendWorkflowRuns).where(eq(trendWorkflowRuns.id, item.runId));
    const blockedItem = trendManualSendGuard(item, Boolean(parentRun?.dryRun));
    if (blockedItem) return res.status(409).json(blockedItem);
    if (!await getWebhook()) return res.status(409).json({ code: "WEBHOOK_NOT_CONFIGURED", error: "Chưa cấu hình Workflow riêng cho Outlier." });
    const prefix = `manual:${item.id}:`;
    const since = new Date(Date.now() - MANUAL_SEND_WINDOW_MS);
    const outboxView = (o: any) => ({ id: o.id, status: o.status, attempts: o.attempts, error: o.lastError, acceptedAt: o.acceptedAt });
    const recent = (await getDb().select().from(trendTeamsOutbox).where(and(eq(trendTeamsOutbox.itemId, item.id), gte(trendTeamsOutbox.createdAt, since))))
      .filter(o => o.idempotencyKey.startsWith(prefix)).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
    if (recent) return res.status(409).json({ code: "RECENTLY_SENT", error: "Trend này vừa được gửi trong 2 phút qua; không gửi lại.", ...outboxView(recent) });
    const blocked = await checkSendTest(getAuthUser(req)!);
    if (blocked) return res.status(blocked.status).json({ code: blocked.code, error: blocked.error });
    const config = await getSettings();
    const drafts = await syncTrendDrafts(await getDb().select().from(trendWorkflowDrafts).where(eq(trendWorkflowDrafts.itemId, item.id)), getDb());
    const hasDraft = drafts.some(d => d.status === "ready" && d.remakeId);
    // Bucket 2 phút trong key: hai request đồng thời cùng chèn một key, unique index chỉ cho một dòng.
    const idempotencyKey = `${prefix}${Math.floor(Date.now() / MANUAL_SEND_WINDOW_MS)}`;
    const inserted = await getDb().insert(trendTeamsOutbox).values({ idempotencyKey, itemId: item.id, nextAttemptAt: new Date(), createdAt: new Date(), payload: buildTrendCard(item.brief as TrendBrief, drafts, config.publicBaseUrl, item.id) }).onConflictDoNothing().returning();
    const [out] = await getDb().select().from(trendTeamsOutbox).where(eq(trendTeamsOutbox.idempotencyKey, idempotencyKey));
    if (!inserted.length) return res.status(409).json({ code: "RECENTLY_SENT", error: "Trend này vừa được gửi trong 2 phút qua; không gửi lại.", ...outboxView(out) });
    await drainOne(out.id);
    const [after] = await getDb().select().from(trendTeamsOutbox).where(eq(trendTeamsOutbox.id, out.id));
    res.json({ ...outboxView(after), warning: hasDraft ? null : "Chưa có bản nháp; thẻ chỉ có nút xem chi tiết.",
      message: after.status === "accepted" ? "Teams đã nhận (chưa xác nhận đã hiển thị)." : after.status === "unknown" ? "Chưa rõ Teams đã nhận chưa; kiểm tra kênh Teams trước khi gửi lại." : after.status === "failed" ? "Teams từ chối thẻ; xem lỗi trong outbox." : "Đã lưu lượt gửi; sẽ thử lại tự động." });
  }));
}
