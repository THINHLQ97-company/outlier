import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { getDb, isDbConfigured } from "../db/client";
import { userActivityLog, users } from "../db/schema";

const ONLINE_MS = 3 * 60_000;
const HISTORY_LIMIT = 200;
const HEARTBEAT_MIN_MS = 45_000;
const lastHeartbeat = new Map<string, number>();

export function activityFromRequest(req: any): { path: string | null } {
  const raw = String(req.originalUrl || req.path || "");
  // Query strings can contain identifiers or user data; keep only the route.
  const path = raw.split("?", 1)[0].slice(0, 300) || null;
  return { path };
}

export async function recordUserActivity(username: string, event: "login" | "heartbeat", req: any): Promise<void> {
  if (!isDbConfigured() || !username) return;
  if (event === "heartbeat") {
    const last = lastHeartbeat.get(username) || 0;
    if (Date.now() - last < HEARTBEAT_MIN_MS) return;
    lastHeartbeat.set(username, Date.now());
  }
  try {
    const [user] = await getDb().select({ id: users.id, isActive: users.isActive }).from(users).where(eq(users.username, username));
    if (!user?.isActive) return;
    const meta = activityFromRequest(req);
    await getDb().insert(userActivityLog).values({ userId: user?.id || null, username, event, path: meta.path });
  } catch (e: any) {
    console.warn("[activity] Không ghi được log:", e?.message || e);
  }
}

export async function activitySnapshot() {
  if (!isDbConfigured()) return { online: [], users: [], history: [] };
  const db = getDb();
  const since = new Date(Date.now() - ONLINE_MS);
  const lastRows = await db.select({ username: userActivityLog.username, lastActivityAt: sql<Date>`max(${userActivityLog.createdAt})`, lastEvent: sql<string>`(array_agg(${userActivityLog.event} order by ${userActivityLog.createdAt} desc))[1]` })
    .from(userActivityLog).groupBy(userActivityLog.username);
  const latest = new Map(lastRows.map(r => [r.username, r]));
  const userRows = await db.select({ username: users.username, email: users.email, role: users.role, isActive: users.isActive, createdAt: users.createdAt }).from(users).orderBy(users.username);
  const usersView = userRows.map(u => {
    const r = latest.get(u.username);
    return { ...u, lastActivityAt: r?.lastActivityAt || null, lastEvent: r?.lastEvent || null, online: !!r?.lastActivityAt && new Date(r.lastActivityAt).getTime() >= since.getTime() };
  });
  const history = await db.select({ id: userActivityLog.id, username: userActivityLog.username, event: userActivityLog.event, path: userActivityLog.path, createdAt: userActivityLog.createdAt }).from(userActivityLog).orderBy(desc(userActivityLog.createdAt)).limit(HISTORY_LIMIT);
  return { online: usersView.filter(u => u.online), users: usersView, history };
}

export async function pruneUserActivity(): Promise<void> {
  if (!isDbConfigured()) return;
  await getDb().delete(userActivityLog).where(lt(userActivityLog.createdAt, new Date(Date.now() - 30 * 24 * 3600_000)));
}

export { ONLINE_MS };
