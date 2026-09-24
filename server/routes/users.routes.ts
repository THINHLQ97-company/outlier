// Quản lý tài khoản (chỉ admin). Không hard-delete — khoá bằng isActive=false.
// Không bao giờ trả passwordHash ra ngoài.
import type { Express } from "express";
import { desc, eq } from "drizzle-orm";
import { getDb, isDbConfigured } from "../db/client";
import { users } from "../db/schema";
import { requireAdmin, requireAuth, getAuthUser } from "../auth-mw";
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Loại passwordHash khỏi payload trả về (không bao giờ lộ hash ra client).
function publicUser(u: any) {
  return {
    id: u.id,
    username: u.username,
    role: u.role,
    isActive: u.isActive,
    authProvider: u.authProvider || "local",
    email: u.email || null,
    avatarUrl: u.avatarUrl || null,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

export function registerUserRoutes(app: Express) {
  // Xem TÊN TRƯỜNG mà dịch vụ quét trả về, lấy từ bộ nhớ đệm.
  //
  // Vì sao cần: mỗi actor đặt tên trường một kiểu, đoán sai thì dữ liệu rơi im
  // lặng (ngày về 0, số bình luận trống) mà không có lỗi nào. Endpoint này đọc
  // lại kết quả ĐÃ LƯU nên không tốn thêm tiền, và chỉ trả về TÊN trường cùng
  // kiểu dữ liệu — không trả nội dung, để không lộ gì.
  app.get("/api/admin/scan-fields", requireAuth, requireAdmin, async (req, res) => {
    try {
      const { apifyCache } = await import("../db/schema");
      const rows = await getDb().select().from(apifyCache).limit(200);
      const prefix = typeof req.query.platform === "string" ? req.query.platform : "";
      const picked = rows.filter((r) => !prefix || r.cacheKey.startsWith(prefix));

      const shape: Record<string, { type: string; sample?: string }> = {};
      for (const r of picked.slice(0, 20)) {
        for (const [k, v] of Object.entries(r.payload || {})) {
          if (shape[k]) continue;
          const type = Array.isArray(v) ? `array(${v.length})` : v === null ? "null" : typeof v;
          // Chỉ lấy mẫu với số và chuỗi ngắn — đủ để nhận ra trường nào là gì.
          const sample =
            typeof v === "number" ? String(v) : typeof v === "string" && v.length <= 40 ? v : undefined;
          shape[k] = { type, sample };
        }
      }

      res.json({
        cacheKeys: picked.slice(0, 5).map((r) => r.cacheKey),
        rowsInspected: Math.min(picked.length, 20),
        fields: shape,
      });
    } catch (e: any) {
      console.error("scan fields:", e?.message || e);
      res.status(500).json({ error: "Không đọc được bộ nhớ đệm." });
    }
  });

  // ===== Chi phí dịch vụ ngoài =====
  // Ai cũng xem được, không riêng quản trị: người tiêu tiền cần thấy mình đã
  // tiêu bao nhiêu, không phải đi hỏi.
  app.get("/api/costs", requireAuth, async (_req, res) => {
    try {
      const { getCostSummary, KIND_LABEL } = await import("../services/cost-tracker");
      const summary = await getCostSummary();
      res.json({ ...summary, kindLabels: KIND_LABEL });
    } catch (e: any) {
      console.error("costs:", e?.message || e);
      res.status(500).json({ error: "Không tải được số liệu chi phí." });
    }
  });

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

  // Cấp quyền đăng nhập Google cho 1 email (mời trước khi họ đăng nhập). Nếu email
  // đã tồn tại (vd đang "chờ duyệt") → duyệt luôn (isActive=true) + đặt role.
  app.post("/api/users/invite", requireAdmin, async (req, res) => {
    if (dbDown(res)) return;
    const emailRaw = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const role = ROLE_VALUES.includes(req.body?.role) ? req.body.role : "member";
    if (!EMAIL_RE.test(emailRaw)) return res.status(400).json({ error: "Email không hợp lệ." });
    try {
      const db = getDb();
      const [existing] = await db.select().from(users).where(eq(users.email, emailRaw));
      if (existing) {
        const [row] = await db
          .update(users)
          .set({ isActive: true, role, updatedAt: new Date() })
          .where(eq(users.id, existing.id))
          .returning();
        return res.json(publicUser(row));
      }
      const [row] = await db
        .insert(users)
        .values({ username: emailRaw, email: emailRaw, role, isActive: true, authProvider: "google" })
        .returning();
      res.status(201).json(publicUser(row));
    } catch (e: any) {
      console.error("invite user:", e?.message || e);
      res.status(500).json({ error: "Cấp quyền email thất bại." });
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
