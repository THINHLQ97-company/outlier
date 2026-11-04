import { and, asc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { trendWorkflowItems as items, trendWorkflowDrafts as drafts, trendTeamsOutbox as outbox, trendWorkflowLease as leases } from "../db/schema";
import { readTrendSettings, type TrendSettings } from "./trend-workflow-settings";

export class TrendDeleted extends Error {}
/** Same item row lock as trash/restore: deletion cannot commit between this check and a draft write. */
export async function assertTrendActive(tx: any, id: string) {
  const [item] = await tx.select().from(items).where(eq(items.id, id)).for("update");
  if (!item || item.deletedAt) throw new TrendDeleted("Trend đã chuyển vào Thùng rác.");
}
export async function trashTrends(ids: string[], owner: string, db: any = getDb(), reason: "manual" | "auto_skipped" | "auto_stale" = "manual", now = new Date()) {
  return db.transaction(async (tx: any) => {
    const changed = await tx.update(items).set({ deletedAt: now, deletedBy: owner, deleteReason: reason }).where(and(inArray(items.id, ids), isNull(items.deletedAt))).returning();
    if (changed.length) await tx.update(outbox).set({ status: "cancelled", lastError: "Trend đã chuyển vào Thùng rác; không gửi Teams." }).where(and(inArray(outbox.itemId, changed.map((r: any) => r.id)), inArray(outbox.status, ["pending", "retry", "sending"])));
    return changed.length;
  });
}
export async function restoreTrends(ids: string[], db: any = getDb()) {
  // Restore never reactivates cancelled Teams deliveries.
  const changed = await db.update(items).set({ deletedAt: null, deletedBy: null, deleteReason: null }).where(and(inArray(items.id, ids), sql`${items.deletedAt} is not null`)).returning();
  return changed.length;
}
/** decision=skip is always persisted as status=skipped (submit/skip/worker). */
const SKIPPED = ["skipped", "excluded", "duplicate"];
/** Finished/parked states. Retryable states only count once the worker has given up (attempts >= 3). */
const idle = ["watch", "skipped", "excluded", "duplicate", "done", "brief_only"];
const RETRYABLE = ["awaiting_research", "error", "budget_exhausted"];
const settled = (r: any) => idle.includes(r.status) || RETRYABLE.includes(r.status) && r.attempts >= 3;
/** Hourly persisted gate serializes replicas; no hard deletion, ever. At most 200 items per hour. */
export async function cleanupTrends(opts: { db?: any; config?: TrendSettings; now?: Date } = {}) {
  const config = opts.config || await readTrendSettings();
  if (!config.autoCleanup) return 0;
  const db = opts.db || getDb(); const now = opts.now || new Date();
  return db.transaction(async (tx: any) => {
    const gate = await tx.insert(leases).values({ key: "trend-cleanup", token: "system", expiresAt: new Date(now.getTime() + 3600_000) }).onConflictDoUpdate({ target: leases.key, set: { expiresAt: new Date(now.getTime() + 3600_000) }, where: lt(leases.expiresAt, now) }).returning();
    if (!gate.length) return 0;
    const noDraft = sql`not exists (select 1 from ${drafts} where ${drafts.itemId} = ${items.id})`;
    const skippedCutoff = new Date(now.getTime() - config.skippedRetentionDays * 86400_000);
    const staleCutoff = new Date(now.getTime() - config.staleRetentionDays * 86400_000);
    const skippedRows = await tx.select().from(items).where(and(isNull(items.deletedAt), inArray(items.status, SKIPPED), lt(items.updatedAt, skippedCutoff), noDraft)).orderBy(asc(items.updatedAt)).limit(200).for("update");
    const staleRows = await tx.select().from(items).where(and(isNull(items.deletedAt), inArray(items.status, idle), lt(items.createdAt, staleCutoff), noDraft)).orderBy(asc(items.createdAt)).limit(200).for("update");
    const stuckRows = await tx.select().from(items).where(and(isNull(items.deletedAt), inArray(items.status, RETRYABLE), gte(items.attempts, 3), lt(items.createdAt, staleCutoff), noDraft)).orderBy(asc(items.createdAt)).limit(200).for("update");
    const candidates = [...new Map([...skippedRows, ...staleRows, ...stuckRows].map((r: any) => [r.id, r])).values()];
    let count = 0;
    for (const item of candidates) {
      // Re-check under lock, including drafts. Keeps the guard explicit and testable.
      if (item.deletedAt || !settled(item)) continue;
      if ((await tx.select().from(drafts).where(eq(drafts.itemId, item.id))).length) continue;
      if (count >= 200) break;
      const reason = SKIPPED.includes(item.status) && new Date(item.updatedAt).getTime() < skippedCutoff.getTime() ? "auto_skipped" : new Date(item.createdAt).getTime() < staleCutoff.getTime() ? "auto_stale" : null;
      if (reason) count += await trashTrends([item.id], "system", tx, reason, now);
    }
    return count;
  });
}
