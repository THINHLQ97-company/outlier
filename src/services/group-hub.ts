import { authHeaders, asError } from "./http";
export interface GroupSnapshot { id: string; periodLabel: string; sourceFilename: string; fileName?: string; createdAt: string; importedAt?: string; expiresAt: string; summary: { topPosts?: any[]; projectSignals?: any[]; dailyNumbers?: any[] } }
export interface GroupProjectSignal { id: string; project: string; signal: string; direction?: "up" | "down" | "stable"; score?: number; week?: string; details?: string; url?: string; comments?: number; reactions?: number; views?: number }
export interface ReportPost { order: number; title: string; body: string; review_status: "needs_review" | "approved" | "rejected"; source_links?: { url: string; note?: string; posted_at?: string | null; posted_at_source?: string }[] }
export interface WeeklyReportDraft { id: string; weekLabel: string; week?: string; title?: string; status: string; scheduledPublishAt?: string | null; createdAt: string; updatedAt: string; draftMarkdown?: string | null; posts?: ReportPost[]; adminNotes?: string | null; trendsJson?: { trends?: any[] } }
export interface WeeklyTrend { week: string; title: string; summary: string; themes?: string[] }
async function get<T>(path: string, fallback: string): Promise<T> { const res = await fetch(path, { headers: authHeaders(false) }); if (!res.ok) return asError(res, fallback); return res.json(); }
export async function getGroupHub() { return get<{ snapshot: GroupSnapshot | null; reports: WeeklyReportDraft[] }>("/api/group-hub", "Không tải được Group Hub."); }
export async function listGroupSnapshots() { const d = await getGroupHub(); return ((d as any).snapshots || (d.snapshot ? [d.snapshot] : [])); }
export async function listProjectSignals() { const d = await getGroupHub(); return (d.snapshot?.summary?.projectSignals || []).map((x: any, i: number) => ({ id: `${d.snapshot?.id}-${i}`, project: x.title || "Chưa rõ dự án", signal: `${x.comments || 0} bình luận · ${x.reactions || 0} reaction · ${x.views || 0} lượt xem`, details: x.title, url: x.url, comments: x.comments, reactions: x.reactions, views: x.views, direction: "stable" as const })); }
export async function listWeeklyDrafts() { const d = await getGroupHub(); return d.reports.map(r => ({ id: r.id, weekLabel: r.weekLabel, title: `Weekly Review ${r.weekLabel}`, status: r.status, scheduledPublishAt: r.scheduledPublishAt, createdAt: r.createdAt, updatedAt: r.updatedAt })); }
export async function getWeeklyTrend(): Promise<WeeklyTrend | null> {
  const d = await getGroupHub(); const r: any = d.reports?.[0]; const trends = r?.trendJson?.trends || [];
  if (trends.length) return { week: r.weekLabel, title: trends[0].title || "Trend nổi bật tuần này", summary: trends.map((t: any) => `${t.title}: ${t.summary || t.why_it_matters || ""}`).join("\n"), themes: trends.map((t: any) => t.title).filter(Boolean) };
  const first = r?.posts?.[0]?.body || r?.draftMarkdown; return first ? { week: r.weekLabel, title: "Tổng hợp tuần này", summary: first.slice(0, 500), themes: [] } : null;
}
export async function getWeeklyReport(id: string): Promise<WeeklyReportDraft & { draftMarkdown?: string | null }> {
  return get(`/api/group-hub/reports/${encodeURIComponent(id)}`, "Không tải được draft Weekly Review.");
}
export async function setWeeklyReportStatus(id: string, status: "approved" | "draft"): Promise<void> {
  const res = await fetch(`/api/group-hub/reports/${encodeURIComponent(id)}`, { method: "PATCH", headers: authHeaders(true), body: JSON.stringify({ status }) });
  if (!res.ok) return asError(res, "Không cập nhật được trạng thái draft.");
}
export async function uploadGroupInsights(file: File): Promise<GroupSnapshot> {
  const dataBase64 = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(r.error); r.readAsDataURL(file); });
  const res = await fetch("/api/group-hub/upload", { method: "POST", headers: authHeaders(true), body: JSON.stringify({ filename: file.name, dataBase64 }) });
  if (!res.ok) return asError(res, "Không tải được file Insights.");
  const d: any = await res.json(); return { id: d.id, periodLabel: file.name, sourceFilename: file.name, createdAt: new Date().toISOString(), expiresAt: d.expiresAt, summary: d.summary };
}
