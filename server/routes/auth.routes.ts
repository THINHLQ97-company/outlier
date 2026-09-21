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
import { verifyGoogleIdToken } from "../services/google-auth";
import { resolveGoogleUser } from "../services/google-user";
import { rateLimit, resetRateLimit } from "../rate-limit";

// Ký token đăng nhập (giống login mật khẩu): base64(payload).hmac, hết hạn 7 ngày.
function issueSessionToken(user: { username: string; role: string }): string {
  const payload = JSON.stringify({ username: user.username, role: user.role, ts: Date.now() });
  const sig = crypto.createHmac("sha256", getSecret()).update(payload).digest("hex");
  return `${Buffer.from(payload).toString("base64")}.${sig}`;
}

export function registerAuthRoutes(app: Express) {
  const loginLimiter = rateLimit({ name: "login", max: 8, windowMs: 10 * 60_000, blockMs: 15 * 60_000 });

  app.post("/api/login", loginLimiter, async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: "Thiếu tên đăng nhập hoặc mật khẩu" });
    }
    if (!isDbConfigured()) {
      return res.status(503).json({ error: "Đăng nhập chưa khả dụng (thiếu DATABASE_URL)." });
    }

    try {
      const [user] = await getDb().select().from(users).where(eq(users.username, username));
      // passwordHash null = tài khoản chỉ đăng nhập Google → không cho login mật khẩu.
      if (!user || !user.isActive || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
        return res.status(401).json({ error: "Sai tài khoản hoặc mật khẩu" });
      }

      // `role` rides along purely so the frontend can show/hide UI fast — it
      // is NEVER trusted for authorization (requireAdmin re-checks the DB).
      const payload = JSON.stringify({ username: user.username, role: user.role, ts: Date.now() });
      const token = crypto.createHmac("sha256", getSecret()).update(payload).digest("hex");

      resetRateLimit(req, "login");
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

  // Đăng nhập bằng Google (Google Identity Services gửi `credential` = ID token).
  // Cấp quyền: email trong GOOGLE_ADMIN_EMAILS → admin ngay; email đã được admin
  // duyệt (isActive) → vào; chưa có/chưa duyệt → tạo bản ghi "chờ duyệt" (isActive=false)
  // rồi báo 403 để admin phê duyệt trong menu Quản trị.
  app.post("/api/auth/google", rateLimit({ name: "google", max: 15, windowMs: 10 * 60_000, blockMs: 10 * 60_000 }), async (req, res) => {
    const credential = req.body?.credential;
    if (typeof credential !== "string" || !credential) {
      return res.status(400).json({ error: "Thiếu credential Google." });
    }
    if (!isDbConfigured()) {
      return res.status(503).json({ error: "Đăng nhập chưa khả dụng (thiếu DATABASE_URL)." });
    }
    let profile;
    try {
      profile = await verifyGoogleIdToken(credential);
    } catch (e: any) {
      console.warn("google verify:", e?.message || e);
      return res.status(401).json({ error: "Xác thực Google thất bại. Thử lại." });
    }
    if (!profile.emailVerified) {
      return res.status(401).json({ error: "Email Google chưa được xác minh." });
    }

    try {
      const { user, pending, rejectedDomain } = await resolveGoogleUser(getDb(), profile);
      if (rejectedDomain) {
        return res.status(403).json({ error: "Chỉ email nội bộ Mắt Bão mới đăng nhập được công cụ này." });
      }
      if (pending || !user) {
        return res.status(403).json({ error: "Tài khoản chưa được cấp quyền — đã gửi yêu cầu tới quản trị viên, vui lòng chờ duyệt.", pending: true });
      }
      return res.json({ success: true, token: issueSessionToken(user), username: user.username, role: user.role });
    } catch (e: any) {
      console.error("google login:", e?.message || e);
      return res.status(500).json({ error: "Lỗi đăng nhập Google." });
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
      return res.status(503).json({ error: "Tính năng tài khoản chưa khả dụng (thiếu DATABASE_URL)." });
    }
    try {
      const [user] = await getDb().select().from(users).where(eq(users.username, username));
      return res.status(200).json({
        username,
        role: user?.role === "admin" ? "admin" : "member",
        isActive: user?.isActive ?? true,
      });
    } catch (e: any) {
      console.error("/api/me:", e?.message || e);
      return res.status(500).json({ error: "Lỗi tải thông tin tài khoản." });
    }
  });
}
