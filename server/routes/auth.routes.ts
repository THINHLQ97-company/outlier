// Login / verify / me — DB-backed accounts (users table), HMAC token (7-day
// expiry). Pattern copied from share-projects/marcow-crop/server.ts.
import type { Express } from "express";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { getDb, isDbConfigured } from "../db/client";
import { users } from "../db/schema";
import { verifyPassword } from "../password";
import { getSecret, verifyToken, extractToken } from "../auth-shared";
import { requireAuth, getAuthUser } from "../auth-mw";

export function registerAuthRoutes(app: Express) {
  app.post("/api/login", async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: "Thiếu tên đăng nhập hoặc mật khẩu" });
    }
    if (!isDbConfigured()) {
      return res.status(503).json({ error: "Đăng nhập chưa khả dụng (thiếu DATABASE_URL)." });
    }

    try {
      const [user] = await getDb().select().from(users).where(eq(users.username, username));
      if (!user || !user.isActive || !verifyPassword(password, user.passwordHash)) {
        return res.status(401).json({ error: "Sai tài khoản hoặc mật khẩu" });
      }

      // `role` rides along purely so the frontend can show/hide UI fast — it
      // is NEVER trusted for authorization (requireAdmin re-checks the DB).
      const payload = JSON.stringify({ username: user.username, role: user.role, ts: Date.now() });
      const token = crypto.createHmac("sha256", getSecret()).update(payload).digest("hex");

      return res.status(200).json({
        success: true,
        token: `${Buffer.from(payload).toString("base64")}.${token}`,
        username: user.username,
        role: user.role,
      });
    } catch (e: any) {
      console.error("login:", e?.message || e);
      return res.status(500).json({ error: "Lỗi đăng nhập." });
    }
  });

  app.post("/api/verify", (req, res) => {
    const result = verifyToken(extractToken(req));
    if (!result.valid) return res.status(401).json({ valid: false });
    return res.status(200).json({ valid: true, username: result.username });
  });

  app.get("/api/me", requireAuth, async (req, res) => {
    const username = getAuthUser(req)!;
    if (!isDbConfigured()) {
      return res.status(200).json({ username, role: "member" });
    }
    try {
      const [user] = await getDb().select().from(users).where(eq(users.username, username));
      return res.status(200).json({ username, role: user?.role === "admin" ? "admin" : "member" });
    } catch (e: any) {
      console.error("/api/me:", e?.message || e);
      return res.status(200).json({ username, role: "member" });
    }
  });
}
