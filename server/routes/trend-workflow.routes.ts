import type { Express } from "express";
import { desc, eq, inArray } from "drizzle-orm";
import { requireAuth as defaultAuth, requireAdmin as defaultAdmin, getAuthUser } from "../auth-mw";
import { getDb as getDefaultDb, isDbConfigured as isDefaultDbConfigured } from "../db/client";
import { brands, brandFanpages, trendWorkflowRuns, trendWorkflowItems, trendWorkflowDrafts, trendTeamsOutbox } from "../db/schema";
import { normalizeSettings, publicTrendSettings, readTrendSettings, saveTrendSettings, withPublicBaseFallback, teamsWebhook } from "../services/trend-workflow-settings";
import { queueTrendDryRun as defaultQueue, lastTrendSlot } from "../services/trend-workflow";
import { buildTrendCard, drainTrendOutbox, recoverStaleTrendOutbox, reserveTrendSendTest, resolveTrendOutbox } from "../services/trend-teams";
import type { TrendBrief } from "../services/trend-research";
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;

export async function sendTestGuard(owner: string, deps = { settings: readTrendSettings, reserve: reserveTrendSendTest }) {
  // Check base URL before spending a rate-limit slot.
  if (!(await deps.settings()).publicBaseUrl) return { status: 409, code: "BASE_URL_REQUIRED", error: "Cần URL Outlier để mở bản nháp từ Teams." };
  if (!await deps.reserve(owner)) return { status: 429, code: "RATE_LIMITED", error: "Tối đa 3 lượt gửi thử hoặc gửi lại mỗi phút mỗi người." };
  return null;
}
export function registerTrendWorkflowRoutes(app: Express, overrides: Partial<{ db: typeof getDefaultDb; configured: typeof isDefaultDbConfigured; auth: typeof defaultAuth; admin: typeof defaultAdmin; queue: typeof defaultQueue; guard: typeof sendTestGuard }> = {}) {
  const defaultGuard = sendTestGuard;
  const { db: getDb, configured: isDbConfigured, auth: requireAuth, admin: requireAdmin, queue: queueTrendDryRun, guard: checkSendTest } = { db: () => getDefaultDb(), configured: isDefaultDbConfigured, auth: defaultAuth, admin: defaultAdmin, queue: defaultQueue, guard: sendTestGuard, ...overrides };
  // Một wrapper chung để lỗi DB không thành unhandled rejection (Express 4).
  const route = (fn: (req: any, res: any) => Promise<any>) => async (req: any, res: any) => {
    if (!isDbConfigured()) return res.status(503).json({ code: "DB_UNAVAILABLE", error: "Chưa cấu hình dữ liệu cho Trend chủ động." });
    try { await fn(req, res); }
    catch { res.status(500).json({ code: "TREND_WORKFLOW_ERROR", error: "Không thực hiện được. Vui lòng thử lại sau." }); }
  };
  app.get("/api/trend-workflow/status", requireAuth, route(async (_req, res) => {
    await recoverStaleTrendOutbox();
    const runs = await getDb().select().from(trendWorkflowRuns).orderBy(desc(trendWorkflowRuns.createdAt)).limit(10);
    const outbox = await getDb().select({ id: trendTeamsOutbox.id, status: trendTeamsOutbox.status, attempts: trendTeamsOutbox.attempts, lastError: trendTeamsOutbox.lastError, acceptedAt: trendTeamsOutbox.acceptedAt, nextAttemptAt: trendTeamsOutbox.nextAttemptAt }).from(trendTeamsOutbox).orderBy(desc(trendTeamsOutbox.createdAt)).limit(30);
    res.json({ settings: await publicTrendSettings(), lastSlot: await lastTrendSlot(), runs, outbox });
  }));
  app.get("/api/trend-workflow/settings", requireAuth, route(async (_req, res) => res.json(await publicTrendSettings())));
  app.put("/api/trend-workflow/settings", requireAuth, requireAdmin, route(async (req, res) => {
    const config = withPublicBaseFallback(normalizeSettings({ ...await readTrendSettings(), ...req.body }), req);
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
  app.get("/api/trend-workflow/targets", requireAuth, route(async (_req, res) => {
    // Select tường minh: không được mang metaTokenEnc của trang ra client.
    const bs = await getDb().select({ id: brands.id, name: brands.name }).from(brands);
    const pages = await getDb().select({ id: brandFanpages.id, brandId: brandFanpages.brandId, pageName: brandFanpages.pageName, platform: brandFanpages.platform, pageUrl: brandFanpages.pageUrl }).from(brandFanpages);
    res.json({ brands: bs, fanpages: pages });
  }));
  app.get("/api/trend-workflow/trends", requireAuth, route(async (req, res) => {
    const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 30));
    const rows = await getDb().select().from(trendWorkflowItems).orderBy(desc(trendWorkflowItems.createdAt)).limit(limit);
    const drafts = rows.length ? await getDb().select().from(trendWorkflowDrafts).where(inArray(trendWorkflowDrafts.itemId, rows.map(r => r.id))) : [];
    res.json({ items: rows.map(r => ({ ...r, facebook: undefined, input: undefined, title: (r.brief as any)?.title || r.title, drafts: drafts.filter(d => d.itemId === r.id).map(d => ({ ...d, href: `/remakes?remakeId=${d.remakeId}` })) })) });
  }));
  app.post("/api/trend-workflow/run", requireAuth, requireAdmin, route(async (req, res) => {
    if (req.body?.dryRun !== true) return res.status(400).json({ code: "DRY_RUN_REQUIRED", error: "Chạy thử bắt buộc dryRun=true; không gửi Teams." });
    // Có thể tốn phí model nhưng vẫn theo đúng trần đã cấu hình trong DB.
    const result = await queueTrendDryRun(getAuthUser(req)!);
    res.status(202).json(result);
  }));
  app.get("/api/trend-workflow/runs/:id", requireAuth, route(async (req, res) => {
    if (!UUID.test(req.params.id)) return res.status(400).json({ code: "INVALID_ID", error: "Mã lượt chạy không hợp lệ." });
    const [run] = await getDb().select().from(trendWorkflowRuns).where(eq(trendWorkflowRuns.id, req.params.id));
    if (!run) return res.status(404).json({ code: "RUN_NOT_FOUND", error: "Không tìm thấy lượt chạy." });
    res.json(run);
  }));
  app.post("/api/trend-workflow/outbox/:id/resolve", requireAuth, requireAdmin, route(async (req, res) => {
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
    const [row] = await getDb().select().from(trendWorkflowItems).where(eq(trendWorkflowItems.id, req.params.id));
    if (!row?.brief) return res.status(404).json({ code: "BRIEF_NOT_FOUND", error: "Chưa có bản tóm tắt cho xu hướng này." });
    const drafts = await getDb().select().from(trendWorkflowDrafts).where(eq(trendWorkflowDrafts.itemId, row.id));
    res.json({ payload: buildTrendCard(row.brief as TrendBrief, drafts, (await readTrendSettings()).publicBaseUrl, row.id, row), sent: false });
  }));
  app.post("/api/trend-workflow/trends/:id/send-test", requireAuth, requireAdmin, route(async (req, res) => {
    const key = String(req.body?.idempotencyKey || "");
    if (req.body?.confirm !== true || !/^[a-zA-Z0-9_-]{8,80}$/.test(key)) return res.status(400).json({ code: "CONFIRM_REQUIRED", error: "Xác nhận gửi thử và cung cấp mã chống gửi trùng (8-80 ký tự)." });
    const blocked = await checkSendTest(getAuthUser(req)!);
    if (blocked) return res.status(blocked.status).json({ code: blocked.code, error: blocked.error });
    const config = await readTrendSettings();
    if (!await teamsWebhook()) return res.status(409).json({ code: "WEBHOOK_NOT_CONFIGURED", error: "Chưa cấu hình Workflow riêng cho Outlier." });
    if (!UUID.test(req.params.id)) return res.status(400).json({ code: "INVALID_ID", error: "Mã xu hướng không hợp lệ." });
    const [item] = await getDb().select().from(trendWorkflowItems).where(eq(trendWorkflowItems.id, req.params.id));
    if (!item?.brief) return res.status(404).json({ code: "BRIEF_NOT_FOUND", error: "Chưa có bản tóm tắt." });
    if (item.status === "excluded") return res.status(409).json({ code: "SENSITIVE_TREND", error: "Xu hướng nhạy cảm đã bị loại; không gửi Teams." });
    const drafts = await getDb().select().from(trendWorkflowDrafts).where(eq(trendWorkflowDrafts.itemId, item.id));
    if (!drafts.some(d => d.status === "ready")) return res.status(409).json({ code: "DRAFT_REQUIRED", error: "Cần có ít nhất một bản nháp sẵn sàng để thẻ mở được bản nháp." });
    const idempotencyKey = `test:${item.id}:${key}`;
    await getDb().insert(trendTeamsOutbox).values({ idempotencyKey, itemId: item.id, payload: buildTrendCard(item.brief as TrendBrief, drafts, config.publicBaseUrl, item.id, item) }).onConflictDoNothing();
    const [out] = await getDb().select().from(trendTeamsOutbox).where(eq(trendTeamsOutbox.idempotencyKey, idempotencyKey));
    await drainTrendOutbox(undefined, out.id);
    const [after] = await getDb().select().from(trendTeamsOutbox).where(eq(trendTeamsOutbox.id, out.id));
    res.json({ id: after.id, status: after.status, attempts: after.attempts, error: after.lastError, message: after.status === "accepted" ? "Teams đã nhận (chưa xác nhận đã hiển thị)." : "Đã lưu trạng thái gửi; xem lại kết quả trong outbox." });
  }));
}
