import type { Express } from "express";
import { requireAdmin, requireAuth, getAuthUser } from "../auth-mw";
import { activitySnapshot, recordUserActivity } from "../services/user-activity";

export function registerActivityRoutes(app: Express) {
  app.post("/api/activity/heartbeat", requireAuth, async (req, res) => {
    const username = getAuthUser(req);
    if (username) await recordUserActivity(username, "heartbeat", req);
    res.status(204).end();
  });

  app.get("/api/admin/activity", requireAuth, requireAdmin, async (_req, res) => {
    try { res.json(await activitySnapshot()); }
    catch (e: any) { console.error("activity snapshot:", e?.message || e); res.status(500).json({ error: "Không tải được log hoạt động." }); }
  });
}
