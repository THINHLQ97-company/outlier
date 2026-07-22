// Đọc bài (posts) — chỉ còn GET. Workflow DUYỆT/ĐĂNG (checklist/approve/
// request-edit/reject/mark-posted) và lịch nội dung (/api/calendar) đã gỡ khỏi
// app theo bản tinh giản (bỏ menu Duyệt / Sẵn sàng đăng / Lịch). Ảnh hậu kỳ
// (select-image/overlay/regenerate) nằm ở images.routes.ts; thư viện ở gallery.
import type { Express } from "express";
import { desc, eq } from "drizzle-orm";
import { getDb, isDbConfigured } from "../db/client";
import { posts } from "../db/schema";
import { requireAuth } from "../auth-mw";

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
}
