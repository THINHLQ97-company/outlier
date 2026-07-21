// DUYỆT + ĐĂNG routes (FR5.x, FR6.x). State machine:
// cho_duyet → (approve) → san_sang_dang → (mark-posted) → da_dang
// cho_duyet → (request-edit) → sua_thoai → (quay lại VẼ, submit lại) → cho_duyet
// cho_duyet → (reject, bắt buộc lý do) → rot → (quay lại DỊCH)
import type { Express } from "express";
import { desc, eq } from "drizzle-orm";
import { getDb, isDbConfigured } from "../db/client";
import { posts } from "../db/schema";
import { requireAuth } from "../auth-mw";
import { CHECKLIST_ITEMS } from "../../shared/engine-data";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function dbDown(res: any): boolean {
  if (!isDbConfigured()) {
    res.status(503).json({ error: "Tính năng dữ liệu chưa khả dụng (thiếu DATABASE_URL)." });
    return true;
  }
  return false;
}

async function loadPost(id: string) {
  const [row] = await getDb().select().from(posts).where(eq(posts.id, id));
  return row;
}

export function registerPostRoutes(app: Express) {
  app.get("/api/posts", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { status } = req.query;
    try {
      const db = getDb();
      const rows =
        typeof status === "string" && status
          ? await db.select().from(posts).where(eq(posts.status, status)).orderBy(desc(posts.createdAt))
          : await db.select().from(posts).orderBy(desc(posts.createdAt));
      res.json(rows);
    } catch (e: any) {
      console.error("list posts:", e?.message || e);
      res.status(500).json({ error: "Lỗi tải danh sách bài." });
    }
  });

  app.get("/api/posts/:id", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "ID không hợp lệ." });
    try {
      const row = await loadPost(id);
      if (!row) return res.status(404).json({ error: "Không tìm thấy bài." });
      res.json(row);
    } catch (e: any) {
      console.error("get post:", e?.message || e);
      res.status(500).json({ error: "Lỗi tải bài." });
    }
  });

  // FR5.2 — checklist 14 mục, lưu tick tạm thời (chưa cần tick hết để lưu nháp).
  app.post("/api/posts/:id/checklist", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "ID không hợp lệ." });
    const { checklistJson } = req.body || {};
    if (!checklistJson || typeof checklistJson !== "object") {
      return res.status(400).json({ error: "Thiếu checklistJson." });
    }
    try {
      const [row] = await getDb().update(posts).set({ checklistJson }).where(eq(posts.id, id)).returning();
      if (!row) return res.status(404).json({ error: "Không tìm thấy bài." });
      res.json(row);
    } catch (e: any) {
      console.error("save checklist:", e?.message || e);
      res.status(500).json({ error: "Lưu checklist thất bại." });
    }
  });

  // FR5.2 — Duyệt: BẮT BUỘC tick hết checklist 14 mục trước khi chuyển
  // "san_sang_dang". Server re-check (không tin tưởng client).
  app.post("/api/posts/:id/approve", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "ID không hợp lệ." });
    try {
      const db = getDb();
      const existing = await loadPost(id);
      if (!existing) return res.status(404).json({ error: "Không tìm thấy bài." });
      if (existing.status !== "cho_duyet") {
        return res.status(400).json({ error: `Bài đang ở trạng thái "${existing.status}", không thể duyệt.` });
      }
      const checklist = existing.checklistJson || {};
      const missing = CHECKLIST_ITEMS.filter((item) => !checklist[item.key]);
      if (missing.length > 0) {
        return res.status(400).json({
          error: `Chưa tick đủ checklist (còn thiếu ${missing.length}/${CHECKLIST_ITEMS.length} mục).`,
          missing: missing.map((m) => m.key),
        });
      }
      const [row] = await db.update(posts).set({ status: "san_sang_dang", decidedAt: new Date() }).where(eq(posts.id, id)).returning();
      res.json(row);
    } catch (e: any) {
      console.error("approve post:", e?.message || e);
      res.status(500).json({ error: "Duyệt bài thất bại." });
    }
  });

  // "Sửa thoại" — quay lại hậu kỳ (VẼ). Post ở lại bảng posts, chỉ đổi status;
  // người vận hành mở lại Image Studio bằng scriptId để chỉnh overlay/caption.
  app.post("/api/posts/:id/request-edit", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "ID không hợp lệ." });
    try {
      const db = getDb();
      const existing = await loadPost(id);
      if (!existing) return res.status(404).json({ error: "Không tìm thấy bài." });
      if (existing.status !== "cho_duyet") {
        return res.status(400).json({ error: `Bài đang ở trạng thái "${existing.status}", không thể chuyển sửa thoại.` });
      }
      const [row] = await db.update(posts).set({ status: "sua_thoai", decidedAt: new Date() }).where(eq(posts.id, id)).returning();
      res.json(row);
    } catch (e: any) {
      console.error("request-edit post:", e?.message || e);
      res.status(500).json({ error: "Chuyển sửa thoại thất bại." });
    }
  });

  // FR5.3 — Rớt: bắt buộc nhập lý do, ghi lại để tham khảo khi DỊCH lại.
  app.post("/api/posts/:id/reject", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "ID không hợp lệ." });
    const { reason } = req.body || {};
    if (!reason || typeof reason !== "string" || !reason.trim()) {
      return res.status(400).json({ error: "Bắt buộc nhập lý do khi đánh dấu Rớt (FR5.3)." });
    }
    try {
      const db = getDb();
      const existing = await loadPost(id);
      if (!existing) return res.status(404).json({ error: "Không tìm thấy bài." });
      if (existing.status !== "cho_duyet") {
        return res.status(400).json({ error: `Bài đang ở trạng thái "${existing.status}", không thể đánh dấu Rớt.` });
      }
      const [row] = await db
        .update(posts)
        .set({ status: "rot", rejectReason: reason.trim(), decidedAt: new Date() })
        .where(eq(posts.id, id))
        .returning();
      res.json(row);
    } catch (e: any) {
      console.error("reject post:", e?.message || e);
      res.status(500).json({ error: "Đánh dấu rớt thất bại." });
    }
  });

  // FR6.2 — Đánh dấu đã đăng (thủ công), nhập link bài Facebook thật.
  app.post("/api/posts/:id/mark-posted", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "ID không hợp lệ." });
    const { fbPostUrl } = req.body || {};
    if (!fbPostUrl || typeof fbPostUrl !== "string") {
      return res.status(400).json({ error: "Thiếu link bài Facebook." });
    }
    try {
      const db = getDb();
      const existing = await loadPost(id);
      if (!existing) return res.status(404).json({ error: "Không tìm thấy bài." });
      if (existing.status !== "san_sang_dang") {
        return res.status(400).json({ error: `Bài đang ở trạng thái "${existing.status}", chưa sẵn sàng đăng.` });
      }
      const [row] = await db
        .update(posts)
        .set({ status: "da_dang", fbPostUrl: fbPostUrl.trim(), postedAt: new Date() })
        .where(eq(posts.id, id))
        .returning();
      res.json(row);
    } catch (e: any) {
      console.error("mark-posted:", e?.message || e);
      res.status(500).json({ error: "Đánh dấu đã đăng thất bại." });
    }
  });
}
