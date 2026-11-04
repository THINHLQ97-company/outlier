import { authHeaders, asError } from "./http";

const base = "/api/trend-workflow";
export interface Target { brandId: string; fanpageId: string }
export interface TrendSettings {
  researchProvider: "claude_mcp" | "gemini" | "off";
  apifyEnabled: boolean; maxFacebookPostsPerTrend: number; maxApifyPosts: number; maxApifyPostsDaily: number;
  enabled: boolean; teamsEnabled: boolean; targets: Target[]; provider: "gemini_search" | "rss"; model: string;
  maxTrends: number; maxModelCalls: number; maxModelCallsDaily: number; maxOutputTokens: number; modelTimeoutMs: number;
  publicBaseUrl: string; webhookConfigured: boolean; keyConfigured: boolean; schedule: string;
}
export interface TrendBrief { provider?: string; title: string; traffic: string; confidence: "sourced" | "unverified"; summary: string; sensitive: boolean; needsReview: boolean; label: string; reason: string; sources: { title: string; url: string }[]; claims: { text: string; urls: string[] }[] }
export interface TrendDraft { remakeId: string; brandId: string; fanpageId: string; pageName: string; angle: string; status: string; error?: string | null }
export interface TrendItem { contentPath?: "facebook_post" | "brief_only"; facebookSourceUrl?: string | null; facebookReason?: string | null; id: string; title: string; status: string; checkpoint: string; brief: TrendBrief | null; error: string | null; attempts: number; drafts: TrendDraft[]; createdAt: string }
export interface TrendRun { id: string; status: string; error: string | null; createdAt: string; dryRun: boolean }
export interface OutboxItem { id: string; status: string; attempts: number; lastError: string | null; acceptedAt: string | null; nextAttemptAt: string | null }
export interface TrendStatus { settings: TrendSettings; lastSlot: unknown; runs: TrendRun[]; outbox: OutboxItem[] }
export interface TrendTargets { brands: { id: string; name: string }[]; fanpages: { id: string; brandId: string; pageName: string; platform: string; pageUrl: string }[] }
export interface TrendCard { payload: { attachments?: { content?: { body?: { text?: string }[]; actions?: { title?: string }[] } }[] }; sent: boolean }
async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(`${base}${path}`, { method, headers: authHeaders(body !== undefined), ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  if (!res.ok) {
    if (res.status === 401) return asError(res, "Không thực hiện được, vui lòng thử lại.");
    const data = await res.json().catch(() => ({}));
    const messages: Record<string, string> = {
      BASE_URL_REQUIRED: "Chưa có địa chỉ Outlier. Hãy lưu địa chỉ website trong phần cài đặt.",
      DRAFT_REQUIRED: "Trend chưa có bản nháp sẵn sàng. Hãy chờ bản nháp hoàn tất rồi thử lại.",
      RATE_LIMITED: "Bạn đã gửi thử hoặc gửi lại 3 lần trong một phút. Hãy chờ một phút rồi thử lại.",
      WEBHOOK_NOT_CONFIGURED: "Chưa có đường dẫn gửi Teams. Hãy lưu đường dẫn trong phần cài đặt.",
      SENSITIVE_TREND: "Trend nhạy cảm không thể gửi lên Teams. Hãy chọn trend khác.",
      OUTBOX_NOT_UNKNOWN: "Thẻ này đã được xử lý hoặc không còn chờ kiểm tra. Hãy tải lại danh sách.",
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
export const getTrends = () => request<{ items: TrendItem[] }>("/trends?limit=100");
export const runDry = () => request<{ runId: string; status: string }>("/run", "POST", { dryRun: true });
export const getCard = (id: string) => request<TrendCard>(`/trends/${encodeURIComponent(id)}/card`);
export const sendTest = (id: string, idempotencyKey: string) => request<{ message: string; status: string }>(`/trends/${encodeURIComponent(id)}/send-test`, "POST", { confirm: true, idempotencyKey });

export const getRun = (id: string) => request<TrendRun>(`/runs/${encodeURIComponent(id)}`);
export const resolveOutbox = (id: string, action: "resolved" | "resend") => request<{ id: string; action: string }>(`/outbox/${encodeURIComponent(id)}/resolve`, "POST", { action, confirm: true, ...(action === "resend" ? { acknowledgeDuplicateRisk: true } : {}) });
