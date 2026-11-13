import { desc, eq, lt, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { groupInsightSnapshots, groupWeeklyReports } from "../db/schema";

export const GROUP_TTL_DAYS = 35;
export const REPORT_TTL_DAYS = 180;

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
  const [row] = await db.select().from(groupWeeklyReports).orderBy(desc(groupWeeklyReports.createdAt)).limit(1);
  return row ? { ...row, rawTrend: undefined } : { available: false, message: "Chưa có draft Weekly Review." };
}
export async function saveGroupReportDraft(db: any, input: { draft_markdown: string; context?: Record<string, any>; week_label?: string; createdBy: string }) {
  const { getDb } = await import("../db/client"); db ||= getDb();
  const now = new Date(); const expiresAt = new Date(now.getTime() + REPORT_TTL_DAYS * 86400000);
  const insights = await getLatestGroupInsights(db);
  const [row] = await db.insert(groupWeeklyReports).values({ weekLabel: input.week_label || now.toISOString().slice(0, 10), trendJson: {}, groupSnapshotId: insights.available ? insights.id : null, contextJson: input.context || {}, draftMarkdown: String(input.draft_markdown).slice(0, 30000), status: "needs_review", createdBy: input.createdBy, expiresAt, updatedAt: now }).returning();
  return { id: row.id, status: row.status, expiresAt: row.expiresAt, message: "Đã lưu draft Weekly Review; admin cần duyệt trước khi đăng." };
}
export async function cleanupGroupHub(db: any = undefined) {
  const { getDb } = await import("../db/client"); db ||= getDb();
  const a = await db.delete(groupInsightSnapshots).where(lt(groupInsightSnapshots.expiresAt, new Date()));
  const b = await db.delete(groupWeeklyReports).where(lt(groupWeeklyReports.expiresAt, new Date()));
  return { snapshots: a.rowCount || 0, reports: b.rowCount || 0 };
}
