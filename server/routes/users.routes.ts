// Quản lý tài khoản (chỉ admin). Không hard-delete — khoá bằng isActive=false.
// Không bao giờ trả passwordHash ra ngoài.
import type { Express } from "express";
import { desc, eq } from "drizzle-orm";
import { getDb, isDbConfigured } from "../db/client";
import { users } from "../db/schema";
import { requireAdmin, getAuthUser } from "../auth-mw";
import { hashPassword } from "../password";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLE_VALUES = ["admin", "member"] as const;

function dbDown(res: any): boolean {
  if (!isDbConfigured()) {
    res.status(503).json({ error: "Tính năng dữ liệu chưa khả dụng (thiếu DATABASE_URL)." });
    return true;
  }
  return false;
}

// Loại passwordHash khỏi payload trả về (không bao giờ lộ hash ra client).
function publicUser(u: any) {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    isActive: u.isActive,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

export function registerUserRoutes(app: Express) {
  app.get("/api/users", requireAdmin, async (_req, res) => {
    if (dbDown(res)) return;
    try {
      const rows = await getDb().select().from(users).orderBy(desc(users.createdAt));
      res.json(rows.map(publicUser));
    } catch (e: any) {
      console.error("list users:", e?.message || e);
      res.status(500).json({ error: "Lỗi tải danh sách tài khoản." });
    }
  });

  app.post("/api/users", requireAdmin, async (req, res) => {
    if (dbDown(res)) return;
    const { username, password, role } = req.body || {};
    if (typeof username !== "string" || !username.trim()) {
      return res.status(400).json({ error: "Thiếu tên đăng nhập." });
    }
    if (typeof password !== "string" || password.length < 6) {
      return res.status(400).json({ error: "Mật khẩu phải từ 6 ký tự trở lên." });
    }
    const roleValue = ROLE_VALUES.includes(role) ? role : "member";
    const uname = username.trim();
    try {
      const db = getDb();
      const [dup] = await db.select().from(users).where(eq(users.username, uname));
      if (dup) return res.status(409).json({ error: "Tên đăng nhập đã tồn tại." });
      const [row] = await db
        .insert(users)
        .values({ username: uname, passwordHash: hashPassword(password), role: roleValue })
        .returning();
      res.status(201).json(publicUser(row));
    } catch (e: any) {
      console.error("create user:", e?.message || e);
      res.status(500).json({ error: "Lỗi tạo tài khoản." });
    }
  });

  app.patch("/api/users/:id", requireAdmin, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "ID không hợp lệ." });
    const { role, isActive, password } = req.body || {};
    try {
      const db = getDb();
      const [existing] = await db.select().from(users).where(eq(users.id, id));
      if (!existing) return res.status(404).json({ error: "Không tìm thấy tài khoản." });

      const me = getAuthUser(req)!;
      const patch: Record<string, any> = { updatedAt: new Date() };
      if (role !== undefined) {
        if (!ROLE_VALUES.includes(role)) return res.status(400).json({ error: "role không hợp lệ." });
        patch.role = role;
      }
      if (isActive !== undefined) {
        if (typeof isActive !== "boolean") return res.status(400).json({ error: "isActive phải là boolean." });
        patch.isActive = isActive;
      }
      if (password !== undefined) {
        if (typeof password !== "string" || password.length < 6) {
          return res.status(400).json({ error: "Mật khẩu phải từ 6 ký tự trở lên." });
        }
        patch.passwordHash = hashPassword(password);
      }

      // Chặn tự khoá / tự hạ quyền chính mình (khoá kẹt toàn hệ thống).
      if (existing.username === me) {
        const willDeactivate = patch.isActive === false;
        const willDemote = patch.role !== undefined && patch.role !== "admin";
        if (willDeactivate || willDemote) {
          return res.status(400).json({ error: "Không thể tự khoá/hạ quyền tài khoản của chính mình." });
        }
      }

      const [row] = await db.update(users).set(patch).where(eq(users.id, id)).returning();
      res.json(publicUser(row));
    } catch (e: any) {
      console.error("update user:", e?.message || e);
      res.status(500).json({ error: "Lỗi cập nhật tài khoản." });
    }
  });
}
