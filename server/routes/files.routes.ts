// Serve file đã lưu trong object storage nội bộ (server/storage.ts) — dùng
// cho ảnh reference nhân vật. Pattern port từ
// share-projects/marcow-crop/server.ts (GET /api/files/*).
import type { Express } from "express";
import { storage, contentTypeForKey } from "../storage";
import { requireAuth } from "../auth-mw";

export function registerFileRoutes(app: Express) {
  app.get("/api/files/*", requireAuth, async (req, res) => {
    const key = (req.params as any)[0] as string;
    if (!key) return res.status(400).json({ error: "Thiếu key." });
    try {
      if (!(await storage.exists(key))) {
        return res.status(404).json({ error: "Không tìm thấy file." });
      }
      const buf = await storage.get(key);
      res.setHeader("Content-Type", contentTypeForKey(key));
      res.setHeader("Cache-Control", "private, max-age=86400");
      return res.send(buf);
    } catch (e: any) {
      console.error("File read error:", e?.message || e);
      return res.status(400).json({ error: "Key không hợp lệ hoặc lỗi đọc file." });
    }
  });
}
