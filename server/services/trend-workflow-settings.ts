import { allSettings, setSetting } from "./app-settings";
import { encryptToken, decryptToken } from "./meta-token";
import { sourceUrl } from "./trend-research";

export interface TrendTarget { brandId: string; fanpageId: string }
export interface TrendSettings {
  autoCleanup: boolean; skippedRetentionDays: number; staleRetentionDays: number;
  researchProvider: "claude_mcp" | "gemini" | "off";
  apifyEnabled: boolean; maxFacebookPostsPerTrend: number; maxApifyPosts: number; maxApifyPostsDaily: number;
  enabled: boolean; teamsEnabled: boolean; targets: TrendTarget[];
  provider: "gemini_search" | "rss"; model: string;
  maxTrends: number; maxModelCalls: number; maxOutputTokens: number;
  maxModelCallsDaily: number; modelTimeoutMs: number; publicBaseUrl: string;
}
export const CONFIG_KEY = "trend_workflow_config";
const SECRET_KEY = "trend_workflow_teams_enc";
const int = (v: unknown, fallback: number, max: number) => Number.isInteger(v) && Number(v) >= 0 ? Math.min(Number(v), max) : fallback;
export function publicBaseUrl(raw: unknown): string {
  try {
    const url = new URL(String(raw || ""));
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch { return ""; }
}
export function normalizeSettings(raw: any = {}): TrendSettings {
  return { autoCleanup: raw.autoCleanup !== false, skippedRetentionDays: retention(raw.skippedRetentionDays, 7, 1, 90), staleRetentionDays: retention(raw.staleRetentionDays, 30, 7, 365), researchProvider: raw.researchProvider === "gemini" ? "gemini" : raw.researchProvider === "off" ? "off" : "claude_mcp",
    apifyEnabled: raw.apifyEnabled === true, maxFacebookPostsPerTrend: int(raw.maxFacebookPostsPerTrend, 1, 1),
    maxApifyPosts: int(raw.maxApifyPosts, 3, 10), maxApifyPostsDaily: int(raw.maxApifyPostsDaily, 10, 50),
    enabled: raw.enabled === true, teamsEnabled: raw.teamsEnabled === true,
    targets: Array.isArray(raw.targets) ? raw.targets.slice(0, 8).map((t: any) => ({ brandId: String(t.brandId || ""), fanpageId: String(t.fanpageId || "") })) : [],
    provider: raw.provider === "rss" ? "rss" : "gemini_search",
    model: String(raw.model || process.env.GEMINI_TEXT_MODEL || "gemini-3.8-flash").slice(0, 100),
    maxTrends: int(raw.maxTrends, 3, 10), maxModelCalls: int(raw.maxModelCalls, 12, 50),
    maxModelCallsDaily: int(raw.maxModelCallsDaily, 60, 200), maxOutputTokens: int(raw.maxOutputTokens, 2048, 4096),
    modelTimeoutMs: Math.max(1000, int(raw.modelTimeoutMs, 45_000, 90_000)),
    publicBaseUrl: publicBaseUrl(raw.publicBaseUrl) || publicBaseUrl(process.env.OUTLIER_PUBLIC_URL),
  };
}
/** Link "Mở bản nháp" không được thiếu: cấu hình → env OUTLIER_PUBLIC_URL (đã xử lý ở normalizeSettings) → origin của chính request admin lưu cài đặt. Chỉ nhận http(s), không dùng các header proxy. */
export function withPublicBaseFallback(config: TrendSettings, req: { headers?: Record<string, unknown>; protocol?: string; get?: (h: string) => string | undefined }): TrendSettings {
  if (config.publicBaseUrl) return config;
  const origin = typeof req.headers?.origin === "string" ? req.headers.origin : req.protocol && req.get?.("host") ? `${req.protocol}://${req.get("host")}` : "";
  const clean = publicBaseUrl(origin);
  if (!clean) return config;
  const u = new URL(clean);
  return { ...config, publicBaseUrl: u.origin };
}
export async function readTrendSettings(): Promise<TrendSettings> {
  const all = await allSettings();
  let raw = {};
  try { raw = JSON.parse(all[CONFIG_KEY] || "{}"); } catch { /* cấu hình hỏng: dùng mặc định an toàn */ }
  // Stored config is trusted less than PUT input: a bad retention value falls back to defaults instead of breaking the feature.
  let config: TrendSettings;
  try { config = normalizeSettings(raw); } catch { config = normalizeSettings({ ...raw, skippedRetentionDays: undefined, staleRetentionDays: undefined }); }
  if (/^(off|false|0)$/i.test(process.env.TREND_WORKFLOW_ENABLED || "")) config.enabled = false;
  return config;
}
export async function teamsWebhook(): Promise<string | null> {
  const all = await allSettings();
  try { return all[SECRET_KEY] ? decryptToken(all[SECRET_KEY]) : process.env.OUTLIER_TEAMS_WEBHOOK_URL || null; }
  catch { return null; }
}
export function validateTeamsWebhook(raw: string): string {
  const url = sourceUrl(raw);
  if (!url) throw new Error("Webhook Teams phải là HTTPS công khai.");
  const host = new URL(url).hostname;
  if (!/(^|\.)logic\.azure\.com$|(^|\.)api\.powerplatform\.com$|(^|\.)webhook\.office\.com$/.test(host)) throw new Error("Chỉ nhận webhook Microsoft Teams Workflows.");
  return raw;
}
export async function saveTrendSettings(config: TrendSettings, owner: string, webhook?: string) {
  if (webhook !== undefined) await setSetting(SECRET_KEY, webhook ? encryptToken(validateTeamsWebhook(webhook)) : "", owner);
  await setSetting(CONFIG_KEY, JSON.stringify(config), owner);
}
export async function publicTrendSettings() {
  return { ...await readTrendSettings(), webhookConfigured: Boolean(await teamsWebhook()), keyConfigured: Boolean(process.env.GEMINI_API_KEY), schedule: "08,10,12,14,16,18,20,22 Asia/Ho_Chi_Minh" };
}

function retention(value: unknown, fallback: number, min: number, max: number) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) throw new Error("Số ngày lưu trend không hợp lệ.");
  return Number(value);
}
