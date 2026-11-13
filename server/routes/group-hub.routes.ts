import type { Express } from "express";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { requireAdmin, requireAuth, getAuthUser } from "../auth-mw";
import { getDb, isDbConfigured } from "../db/client";
import { groupInsightSnapshots, groupWeeklyReports } from "../db/schema";
import { summarizeGroupWorkbook, sha256, cleanupGroupHub, listGroupReports, archiveGroupReport, splitLegacyDraft } from "../services/group-hub";

const MAX_XLSX = 10 * 1024 * 1024;
function down(res: any) { if (!isDbConfigured()) { res.status(503).json({ error: "Tính năng Group Hub chưa khả dụng (thiếu DATABASE_URL)." }); return true; } return false; }
export function registerGroupHubRoutes(app: Express) {
  app.get("/api/group-hub", requireAuth, async (_req, res) => {
    if (down(res)) return;
    const db = getDb();
    const snapshots = await db.select().from(groupInsightSnapshots).where(and(sql`${groupInsightSnapshots.expiresAt} > now()`)).orderBy(desc(groupInsightSnapshots.createdAt)).limit(12);
    const [snapshot] = snapshots;
    const reports = await db.select({ id: groupWeeklyReports.id, weekLabel: groupWeeklyReports.weekLabel, status: groupWeeklyReports.status, trendJson: groupWeeklyReports.trendJson, postsJson: groupWeeklyReports.postsJson, adminNotes: groupWeeklyReports.adminNotes, scheduledPublishAt: groupWeeklyReports.scheduledPublishAt, createdBy: groupWeeklyReports.createdBy, createdAt: groupWeeklyReports.createdAt, expiresAt: groupWeeklyReports.expiresAt }).from(groupWeeklyReports).where(sql`${groupWeeklyReports.status} <> 'archived'`).orderBy(desc(groupWeeklyReports.createdAt)).limit(12);
    res.json({ snapshots: snapshots.map(s => ({ id: s.id, periodLabel: s.periodLabel, sourceFilename: s.sourceFilename, summary: s.summaryJson, expiresAt: s.expiresAt, createdAt: s.createdAt })), snapshot: snapshot ? { id: snapshot.id, periodLabel: snapshot.periodLabel, sourceFilename: snapshot.sourceFilename, summary: snapshot.summaryJson, expiresAt: snapshot.expiresAt, createdAt: snapshot.createdAt } : null, reports });
  });
  app.post("/api/group-hub/upload", requireAuth, requireAdmin, async (req, res) => {
    if (down(res)) return;
    try {
      const raw = String(req.body?.dataBase64 || "").replace(/^data:.*?;base64,/, "");
      const filename = String(req.body?.filename || "group-insights.xlsx").slice(0, 200);
      if (!raw) return res.status(400).json({ error: "Thiếu file XLSX." });
      const buffer = Buffer.from(raw, "base64");
      if (!buffer.length || buffer.length > MAX_XLSX) return res.status(400).json({ error: "File rỗng hoặc quá lớn (tối đa 10MB)." });
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
      const sheets: Record<string, any[][]> = {};
      for (const name of workbook.SheetNames.slice(0, 20)) sheets[name] = XLSX.utils.sheet_to_json<any[]>(workbook.Sheets[name], { header: 1, raw: true, defval: null }).slice(0, 500) as any[][];
      const summary = summarizeGroupWorkbook(sheets);
      const digest = sha256(buffer);
      const existing = await getDb().select({ id: groupInsightSnapshots.id }).from(groupInsightSnapshots).where(eq(groupInsightSnapshots.sourceSha256, digest));
      if (existing.length) return res.status(409).json({ error: "File này đã được nhập trước đó.", id: existing[0].id });
      const now = new Date(); const [row] = await getDb().insert(groupInsightSnapshots).values({ periodLabel: String(req.body?.periodLabel || filename.replace(/\.xlsx$/i, "")).slice(0, 80), sourceFilename: filename, sourceSha256: digest, rawJson: { sheets }, summaryJson: summary, uploadedBy: getAuthUser(req)!, expiresAt: new Date(now.getTime() + 35 * 86400000) }).returning();
      await cleanupGroupHub(getDb());
      res.status(201).json({ id: row.id, summary: row.summaryJson, expiresAt: row.expiresAt });
    } catch (e: any) { console.error("group hub upload:", e?.message || e); res.status(400).json({ error: "Không đọc được file XLSX Group Insights." }); }
  });
  app.get("/api/group-hub/reports", requireAuth, async (_req, res) => { if (down(res)) return; res.json(await listGroupReports(getDb())); });
  app.delete("/api/group-hub/reports/:id", requireAuth, requireAdmin, async (req, res) => { if (down(res)) return; res.json(await archiveGroupReport(getDb(), req.params.id)); });
  app.get("/api/group-hub/reports/:id", requireAuth, async (req, res) => {
    if (down(res)) return;
    const [row] = await getDb().select().from(groupWeeklyReports).where(eq(groupWeeklyReports.id, req.params.id));
    if (!row) return res.status(404).json({ error: "Không tìm thấy draft." });
    res.json({ ...row, posts: row.postsJson?.length ? row.postsJson : splitLegacyDraft(row.draftMarkdown || "") });
  });
  app.patch("/api/group-hub/reports/:id", requireAuth, requireAdmin, async (req, res) => {
    if (down(res)) return;
    const status = ["draft", "needs_review", "approved", "published"].includes(String(req.body?.status)) ? String(req.body.status) : null;
    if (!status) return res.status(400).json({ error: "Trạng thái draft không hợp lệ." });
    const [row] = await getDb().update(groupWeeklyReports).set({ status, updatedAt: new Date() }).where(eq(groupWeeklyReports.id, req.params.id)).returning({ id: groupWeeklyReports.id, status: groupWeeklyReports.status });
    if (!row) return res.status(404).json({ error: "Không tìm thấy draft." });
    res.json(row);
  });
}
