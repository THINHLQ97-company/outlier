import { desc, eq, lt, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { groupInsightSnapshots, groupWeeklyReports } from "../db/schema";

export const GROUP_TTL_DAYS = 35;
export const REPORT_TTL_DAYS = 180;

export type SourceLink = { url: string; note?: string; posted_at?: string | null; posted_at_source?: "xlsx" | "estimated" | "unknown" };
export type ReportPost = { order: number; title: string; body: string; suggested_publish_at?: string | null; source_links?: SourceLink[]; review_status: "needs_review" | "approved" | "rejected" };
export function splitLegacyDraft(markdown = ""): ReportPost[] {
  const chunks = markdown.split(/^\s*(?:#+\s*)?POST\s+(\d+)\s*:?.*$/gim); const out: ReportPost[] = [];
  for (let i = 1; i < chunks.length; i += 2) { const order = Number(chunks[i]); const body = (chunks[i + 1] || "").replace(/^[-=_]{3,}\s*$/gm, "").trim(); if (body) out.push({ order, title: `Post ${order}`, body, review_status: "needs_review" }); }
  if (!out.length && markdown.trim()) out.push({ order: 1, title: "Post 1", body: markdown.trim(), review_status: "needs_review" });
  return out.slice(0, 5);
}
export function saturdayAtNineUtc(weekDate: string): Date {
  const d = new Date(`${weekDate}T00:00:00Z`); const day = d.getUTCDay(); d.setUTCDate(d.getUTCDate() + ((6 - day + 7) % 7)); d.setUTCHours(2, 0, 0, 0); return d;
}


export function summarizeGroupWorkbook(sheets: Record<string, any[][]>) {
  const top = (sheets["Top posts (last 28 days)"] || []).slice(1).filter(r => r[5]).slice(0, 120).map(r => ({ title: String(r[0] || "").slice(0, 500), author: String(r[1] || "").slice(0, 160), comments: Number(r[2]) || 0, reactions: Number(r[3]) || 0, views: Number(r[4]) || 0, url: String(r[5]).slice(0, 500) }));
  const daily = (sheets["Daily numbers"] || []).slice(1).map(r => ({ date: String(r[0] || "").slice(0, 20), joined: Number(r[1]) || 0, postedOrCommented: Number(r[2]) || 0, viewed: Number(r[3]) || 0, posts: Number(r[4]) || 0, comments: Number(r[5]) || 0, reactions: Number(r[6]) || 0 })).slice(-35);
  const projects = top.filter(p => /dự án|project|tool|app|website|web|ai|vibe/i.test(p.title)).slice(0, 30);
  return { topPosts: top, projectSignals: projects, dailyNumbers: daily, sheetNames: Object.keys(sheets) };
}
export function sha256(data: Buffer) { return createHash("sha256").update(data).digest("hex"); }
export async function getLatestGroupInsights(db: any = undefined) {
  const { getDb } = await import("../db/client"); db ||= getDb();
  const [row] = await db.select().from(groupInsightSnapshots).where(sql`${groupInsightSnapshots.expiresAt} > now()`).orderBy(desc(groupInsightSnapshots.createdAt)).limit(1);
  if (!row) return { available: false, message: "Chưa có snapshot Group Insights còn hạn." };
  return { available: true, id: row.id, periodLabel: row.periodLabel, sourceFilename: row.sourceFilename, summary: row.summaryJson, expiresAt: row.expiresAt, createdAt: row.createdAt };
}
export async function getLatestGroupReport(db: any = undefined) {
  const { getDb } = await import("../db/client"); db ||= getDb();
  const [row] = await db.select().from(groupWeeklyReports).where(sql`${groupWeeklyReports.status} <> 'archived'`).orderBy(desc(groupWeeklyReports.createdAt)).limit(1);
  return row ? { ...row, posts: row.postsJson?.length ? row.postsJson : splitLegacyDraft(row.draftMarkdown || "") } : { available: false, message: "Chưa có draft Weekly Review." };
}
export async function saveGroupReportDraft(db: any, input: { draft_markdown?: string; context?: Record<string, any>; week_label?: string; posts?: any[]; admin_notes?: string; trends?: any[]; createdBy: string }) {
  const { getDb } = await import("../db/client"); db ||= getDb();
  const now = new Date(); const expiresAt = new Date(now.getTime() + REPORT_TTL_DAYS * 86400000);
  const weekLabel = String(input.week_label || now.toISOString().slice(0, 10)).slice(0, 30);
  const weekStart = /^\d{4}-\d{2}-\d{2}$/.test(weekLabel) ? weekLabel : now.toISOString().slice(0, 10);
  const scheduledPublishAt = saturdayAtNineUtc(weekStart);
  const posts = (Array.isArray(input.posts) && input.posts.length ? input.posts : splitLegacyDraft(input.draft_markdown || "")).slice(0, 5).map((p: any, i: number) => ({ order: Number(p.order) || i + 1, title: String(p.title || `Post ${i + 1}`).slice(0, 160), body: String(p.body || "").slice(0, 12000), suggested_publish_at: p.suggested_publish_at || null, source_links: Array.isArray(p.source_links) ? p.source_links.slice(0, 20) : [], review_status: ["approved", "rejected"].includes(p.review_status) ? p.review_status : "needs_review" }));
  const insights = await getLatestGroupInsights(db);
  const values = { weekLabel, trendJson: { trends: Array.isArray(input.trends) ? input.trends.slice(0, 10) : [] }, groupSnapshotId: insights.available ? insights.id : null, contextJson: input.context || {}, draftMarkdown: input.draft_markdown ? String(input.draft_markdown).slice(0, 30000) : null, postsJson: posts, adminNotes: input.admin_notes ? String(input.admin_notes).slice(0, 8000) : null, status: "needs_review", scheduledPublishAt, createdBy: input.createdBy, expiresAt, updatedAt: now };
  const [existing] = await db.select({ id: groupWeeklyReports.id }).from(groupWeeklyReports).where(eq(groupWeeklyReports.weekLabel, weekLabel)).orderBy(desc(groupWeeklyReports.updatedAt)).limit(1);
  const [row] = existing ? await db.update(groupWeeklyReports).set(values).where(eq(groupWeeklyReports.id, existing.id)).returning() : await db.insert(groupWeeklyReports).values(values).returning();
  return { id: row.id, replaced: !!existing, status: row.status, posts: row.postsJson, scheduledPublishAt: row.scheduledPublishAt, expiresAt: row.expiresAt, message: existing ? "Đã cập nhật Weekly Review hiện có của tuần." : "Đã lưu Weekly Review mới; admin cần duyệt trước khi đăng." };
}
export async function listGroupReports(db: any = undefined) {
  const { getDb } = await import("../db/client"); db ||= getDb();
  const rows = await db.select().from(groupWeeklyReports).orderBy(desc(groupWeeklyReports.createdAt)).limit(30);
  return rows.map((r: any) => ({ ...r, posts: r.postsJson?.length ? r.postsJson : splitLegacyDraft(r.draftMarkdown || "") }));
}
export async function archiveGroupReport(db: any, id: string) {
  const { getDb } = await import("../db/client"); db ||= getDb();
  const [row] = await db.update(groupWeeklyReports).set({ status: "archived", updatedAt: new Date() }).where(eq(groupWeeklyReports.id, id)).returning({ id: groupWeeklyReports.id });
  return row ? { archived: true, id: row.id } : { archived: false, id };
}
export async function cleanupGroupHub(db: any = undefined) {
  const { getDb } = await import("../db/client"); db ||= getDb();
  const a = await db.delete(groupInsightSnapshots).where(lt(groupInsightSnapshots.expiresAt, new Date()));
  const b = await db.delete(groupWeeklyReports).where(lt(groupWeeklyReports.expiresAt, new Date()));
  return { snapshots: a.rowCount || 0, reports: b.rowCount || 0 };
}
