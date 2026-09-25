// Serve file đã lưu trong object storage nội bộ (server/storage.ts) — dùng
// cho ảnh reference nhân vật. Pattern port từ
// share-projects/marcow-crop/server.ts (GET /api/files/*).
import type { Express } from "express";
import { storage, contentTypeForKey } from "../storage";
import { requireAuth } from "../auth-mw";
import { verifyFileLink } from "../services/file-link";

export function registerFileRoutes(app: Express) {
  // Hai đường vào: phiên đăng nhập (ảnh hiện trong app), hoặc link đã ký (ảnh
  // Claude trả vào khung chat — bấm vào là mở tab mới, không có phiên).
  const authOrSignedLink: any = (req: any, res: any, next: any) => {
    const key = (req.params as any)[0] as string;
    if (key && (req.query.sig || req.query.exp)) {
      const check = verifyFileLink(key, req.query.exp, req.query.sig);
      if (check.ok) return next();
      return res.status(403).json({ error: `Không xem được ảnh: ${check.reason}.` });
    }
    return requireAuth(req, res, next);
  };

  app.get("/api/files/*", authOrSignedLink, async (req, res) => {
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
