import { authHeaders, asError } from "./http";

const base = "/api/trend-workflow";
export interface Target { brandId: string; fanpageId: string }
export interface TrendSettings {
  autoCleanup: boolean; skippedRetentionDays: number; staleRetentionDays: number;
  researchProvider: "claude_mcp" | "gemini" | "off";
  apifyEnabled: boolean; maxFacebookPostsPerTrend: number; maxApifyPosts: number; maxApifyPostsDaily: number;
  enabled: boolean; teamsEnabled: boolean; targets: Target[]; provider: "gemini_search" | "rss"; model: string;
  maxTrends: number; maxModelCalls: number; maxModelCallsDaily: number; maxOutputTokens: number; modelTimeoutMs: number;
  publicBaseUrl: string; webhookConfigured: boolean; keyConfigured: boolean; schedule: string;
}
export interface TrendBrief { provider?: string; title: string; traffic: string; confidence: "sourced" | "unverified"; summary: string; sensitive: boolean; needsReview: boolean; label: string; reason?: string; suggestedAngle?: string; decision?: "pursue" | "watch" | "skip"; decisionRationale?: string; pageAngles?: { fanpageId?: string; pageName?: string; angle: string }[]; avoid?: string[]; sources: { title?: string; url: string; publisher?: string; publishedAt?: string }[]; claims: { text: string; urls: string[] }[] }
export interface TrendDraft { remakeId: string; brandId: string; fanpageId: string; pageName: string; angle: string; status: string; error?: string | null }
export interface TrendItem { decision?: "pursue" | "watch" | "skip" | null; discoverySource?: "google_trends" | "claude" | null; skipReason?: string | null; contentPath?: "facebook_post" | "brief_only"; facebookSourceUrl?: string | null; facebookReason?: string | null; id: string; title: string; status: string; checkpoint: string; brief: TrendBrief | null; error: string | null; attempts: number; drafts: TrendDraft[]; createdAt: string; deletedAt?: string | null; deleteReason?: "manual" | "auto_skipped" | "auto_stale" | null }
export interface TrendRun { id: string; status: string; error: string | null; createdAt: string; dryRun: boolean }
export interface OutboxItem { id: string; status: string; attempts: number; lastError: string | null; acceptedAt: string | null; nextAttemptAt: string | null }
export interface TrendStatus { settings: Pick<TrendSettings, "enabled"> & { skippedRetentionDays?: number } & { researchProvider?: TrendSettings["researchProvider"]; hasTargets?: boolean }; canConfigure: boolean; hasTargets?: boolean; lastRefreshAt?: string | null; refreshedBy?: "Claude" | "chạy thử" | null; lastSlot: unknown; runs: TrendRun[]; outbox: OutboxItem[] }
export interface TrendTargets { brands: { id: string; name: string }[]; fanpages: { id: string; brandId: string; pageName: string; platform: string; pageUrl: string }[] }
export interface TrendCard { payload: { attachments?: { content?: { body?: { text?: string; size?: string; weight?: string; color?: string; isSubtle?: boolean }[]; actions?: { title?: string; url?: string }[] } }[] }; sent: boolean }
async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(`${base}${path}`, { method, headers: authHeaders(body !== undefined), ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  if (!res.ok) {
    if (res.status === 401) return asError(res, "Không thực hiện được, vui lòng thử lại.");
    const data = await res.json().catch(() => ({}));
    const messages: Record<string, string> = {
      BASE_URL_REQUIRED: "Chưa tạo được đường dẫn mở bản nháp. Hãy mở Outlier bằng địa chỉ chính thức rồi lưu lại cài đặt.",
      DRAFT_REQUIRED: "Trend chưa có bản nháp sẵn sàng. Hãy chờ bản nháp hoàn tất rồi thử lại.",
      RATE_LIMITED: "Bạn đã gửi thử hoặc gửi lại 3 lần trong một phút. Hãy chờ một phút rồi thử lại.",
      WEBHOOK_NOT_CONFIGURED: "Chưa có đường dẫn gửi Teams. Hãy lưu đường dẫn trong phần cài đặt.",
      DRY_RUN_ONLY: "Đây là trend của lần chạy thử nên không gửi lên Teams. Hãy để Claude lấy hoặc nộp trend trong lần chạy thật.",
      DECISION_REQUIRED: "Claude chưa chọn đu trend này; chỉ gửi thử được trend đã được chọn đu.",
      SENSITIVE_TREND: "Trend nhạy cảm không thể gửi lên Teams. Hãy chọn trend khác.",
      OUTBOX_NOT_UNKNOWN: "Thẻ này đã được xử lý hoặc không còn chờ kiểm tra. Hãy tải lại danh sách.",
      INVALID_IDS: "Danh sách trend chọn không hợp lệ. Hãy tải lại trang rồi thử lại.",
      INVALID_RETENTION: "Số ngày lưu không hợp lệ: trend đã bỏ qua từ 1 đến 90 ngày, trend cũ từ 7 đến 365 ngày.",
      BRIEF_NOT_FOUND: "Chưa có bản tóm tắt. Hãy chọn trend khác hoặc chờ xử lý xong.",
    };
    throw new Error(messages[data.code] || data.reason || data.error || (res.status === 429 ? messages.RATE_LIMITED : "Không thực hiện được, vui lòng thử lại."));
  }
  return res.json();
}
export const getSettings = () => request<TrendSettings>("/settings");
export const saveSettings = (settings: Partial<TrendSettings> & { teamsWebhookUrl?: string }) => request<TrendSettings>("/settings", "PUT", settings);
export const getStatus = () => request<TrendStatus>("/status");
export const getTargets = () => request<TrendTargets>("/targets");
/** Read every page: old/skipped trends must not be trapped beyond the first 100 cards. */
async function allTrends(trash = false) {
  const first = await request<{ items: TrendItem[]; total?: number; trashTotal?: number }>(`/trends?limit=100${trash ? "&trash=1" : ""}`);
  const items = [...first.items];
  let offset = first.items.length;
  while (offset < (first.total ?? offset)) {
    const page = await request<{ items: TrendItem[] }>(`/trends?limit=100&offset=${offset}${trash ? "&trash=1" : ""}`);
    if (!page.items.length) break;
    items.push(...page.items); offset += page.items.length;
  }
  return { ...first, items: [...new Map(items.map(i => [i.id, i])).values()], total: first.total ?? items.length };
}
export const getTrends = () => allTrends();
export const getTrash = () => allTrends(true);
/** Server nhận tối đa 200 mã mỗi lần; chia lô để "chuyển tất cả" không bị từ chối. */
async function batched(path: string, ids: string[]) {
  let count = 0;
  for (let i = 0; i < ids.length; i += 200) count += (await request<{ count: number }>(path, "POST", { ids: ids.slice(i, i + 200) })).count;
  return count;
}
export const trashTrends = (ids: string[]) => batched("/trends/delete", ids);
export const restoreTrends = (ids: string[]) => batched("/trends/restore", ids);
export const runDry = () => request<{ runId: string | null; status: string; created?: number; note?: string }>("/run", "POST", { dryRun: true });
export const getCard = (id: string) => request<TrendCard>(`/trends/${encodeURIComponent(id)}/card`);
export const sendTest = (id: string, idempotencyKey: string) => request<{ message: string; status: string }>(`/trends/${encodeURIComponent(id)}/send-test`, "POST", { confirm: true, idempotencyKey });

export const getRun = (id: string) => request<TrendRun>(`/runs/${encodeURIComponent(id)}`);
export const resolveOutbox = (id: string, action: "resolved" | "resend") => request<{ id: string; action: string }>(`/outbox/${encodeURIComponent(id)}/resolve`, "POST", { action, confirm: true, ...(action === "resend" ? { acknowledgeDuplicateRisk: true } : {}) });
