// Express auth middleware shared by server.ts and route modules. Pattern
// copied from share-projects/marcow-crop/server/auth-mw.ts.
import { eq } from "drizzle-orm";
import { verifyToken, extractToken } from "./auth-shared";
import { getDb, isDbConfigured } from "./db/client";
import { users } from "./db/schema";

// Returns the authenticated username (or undefined if the token is invalid).
export function getAuthUser(req: any): string | undefined {
  return verifyToken(extractToken(req)).username;
}

// Guard: 401 unless the request carries a valid login token.
export function requireAuth(req: any, res: any, next: any) {
  if (!verifyToken(extractToken(req)).valid) {
    return res.status(401).json({ error: "Cần đăng nhập. Vui lòng đăng nhập lại." });
  }
  next();
}

// Guard: 403 unless the request's user is currently an active admin.
// Re-checks the `users` table on every call instead of trusting a `role`
// claim baked into the token (tokens live up to 7 days) so revoking admin
// access takes effect right away.
export async function requireAdmin(req: any, res: any, next: any) {
  const result = verifyToken(extractToken(req));
  if (!result.valid || !result.username) {
    return res.status(401).json({ error: "Cần đăng nhập. Vui lòng đăng nhập lại." });
  }
  if (!isDbConfigured()) {
    return res.status(503).json({ error: "Tính năng quản trị chưa khả dụng (thiếu DATABASE_URL)." });
  }
  try {
    const [user] = await getDb().select().from(users).where(eq(users.username, result.username));
    if (!user || user.role !== "admin" || !user.isActive) {
      return res.status(403).json({ error: "Bạn không có quyền truy cập trang quản trị." });
    }
    next();
  } catch (e: any) {
    console.error("requireAdmin:", e?.message || e);
    res.status(500).json({ error: "Lỗi kiểm tra quyền quản trị." });
  }
}
