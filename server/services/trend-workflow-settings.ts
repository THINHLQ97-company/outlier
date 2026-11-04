import { allSettings, setSetting } from "./app-settings";
import { encryptToken, decryptToken } from "./meta-token";
import { sourceUrl } from "./trend-research";

export interface TrendTarget { brandId: string; fanpageId: string }
export interface TrendSettings {
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
export function normalizeSettings(raw: any = {}): TrendSettings {
  return { researchProvider: raw.researchProvider === "gemini" ? "gemini" : raw.researchProvider === "off" ? "off" : "claude_mcp",
    apifyEnabled: raw.apifyEnabled === true, maxFacebookPostsPerTrend: int(raw.maxFacebookPostsPerTrend, 1, 1),
    maxApifyPosts: int(raw.maxApifyPosts, 3, 10), maxApifyPostsDaily: int(raw.maxApifyPostsDaily, 10, 50),
    enabled: raw.enabled === true, teamsEnabled: raw.teamsEnabled === true,
    targets: Array.isArray(raw.targets) ? raw.targets.slice(0, 8).map((t: any) => ({ brandId: String(t.brandId || ""), fanpageId: String(t.fanpageId || "") })) : [],
    provider: raw.provider === "rss" ? "rss" : "gemini_search",
    model: String(raw.model || process.env.GEMINI_TEXT_MODEL || "gemini-3.8-flash").slice(0, 100),
    maxTrends: int(raw.maxTrends, 3, 10), maxModelCalls: int(raw.maxModelCalls, 12, 50),
    maxModelCallsDaily: int(raw.maxModelCallsDaily, 60, 200), maxOutputTokens: int(raw.maxOutputTokens, 2048, 4096),
    modelTimeoutMs: Math.max(1000, int(raw.modelTimeoutMs, 45_000, 90_000)),
    publicBaseUrl: sourceUrl(String(raw.publicBaseUrl || process.env.OUTLIER_PUBLIC_URL || ""))?.replace(/\/$/, "") || "",
  };
}
export async function readTrendSettings(): Promise<TrendSettings> {
  const all = await allSettings();
  let raw = {};
  try { raw = JSON.parse(all[CONFIG_KEY] || "{}"); } catch { /* cấu hình hỏng: dùng mặc định an toàn */ }
  const config = normalizeSettings(raw);
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
