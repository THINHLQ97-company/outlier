// Chuyển dữ liệu giữa hai bản cài (Coolify → Vibe Host).
//
// Vì sao phải đi qua HTTP thay vì pg_dump: hai database đều đóng, không mở cổng
// ra ngoài, và không bản nào cho lấy chuỗi kết nối. Cửa này chạy bằng quyền
// admin sẵn có của app, nên không cần mở thêm gì ở tầng hạ tầng.
//
// Ảnh nằm trong bảng `files` (base64) chứ không phải trên đĩa, nên xuất bảng là
// xuất luôn thư viện ảnh và ảnh của thư viện nhân vật.
import type { Express } from "express";
import { getDb, isDbConfigured } from "../db/client";
import { requireAuth, requireAdmin } from "../auth-mw";
import * as schema from "../db/schema";

// Thứ tự có ý nghĩa: bảng được tham chiếu phải vào trước bảng tham chiếu nó,
// nếu không khoá ngoại sẽ chặn. `users` cố ý KHÔNG nằm đây — tài khoản và mật
// khẩu thuộc về từng bản cài, không mang đi.
const TABLES = [
  "characters",
  "styles",
  "rubric_versions",
  "brands",
  "brand_sources",
  "brand_fanpages",
  "signals",
  "scripts",
  "posts",
  "assets",
  "watched_channels",
  "channel_baselines",
  "channel_seen_items",
  "radar_jobs",
  "radar_items",
  "deconstructions",
  "remakes",
  "video_projects",
  "video_scenes",
  "rag_profiles",
  "rag_examples",
  "files",
] as const;

// Tên bảng trong Postgres → biến Drizzle tương ứng.
function tableOf(name: string): any {
  for (const value of Object.values(schema)) {
    const sym = (value as any)?.[Symbol.for("drizzle:Name")];
    if (sym === name) return value;
  }
  return null;
}

export function registerTransferRoutes(app: Express) {
  // Đếm số dòng từng bảng — xem có gì đáng chuyển trước khi tải cả gói.
  app.get("/api/admin/transfer/summary", requireAuth, requireAdmin, async (_req, res) => {
    if (!isDbConfigured()) return res.status(503).json({ error: "DATABASE_URL chưa cấu hình." });
    const db = getDb();
    const counts: Record<string, number> = {};
    for (const name of TABLES) {
      const t = tableOf(name);
      if (!t) continue;
      try {
        counts[name] = (await db.select().from(t)).length;
      } catch {
        counts[name] = -1; // bảng chưa có (bản cũ chưa migrate tới)
      }
    }
    res.json({ tables: counts });
  });

  // Xuất toàn bộ. withFiles=0 để bỏ ảnh ra cho gói nhẹ.
  app.get("/api/admin/transfer/export", requireAuth, requireAdmin, async (req, res) => {
    if (!isDbConfigured()) return res.status(503).json({ error: "DATABASE_URL chưa cấu hình." });
    const db = getDb();
    const withFiles = String(req.query.withFiles ?? "1") !== "0";
    const out: Record<string, any[]> = {};
    for (const name of TABLES) {
      if (name === "files" && !withFiles) continue;
      const t = tableOf(name);
      if (!t) continue;
      try {
        out[name] = await db.select().from(t);
      } catch {
        // Bảng chưa tồn tại ở bản nguồn — bỏ qua, không làm hỏng cả gói.
      }
    }
    res.setHeader("content-disposition", 'attachment; filename="outlier-export.json"');
    res.json({ version: 1, exportedAt: new Date().toISOString(), tables: out });
  });

  // Nhận một lô. Gọi nhiều lần, mỗi lần một bảng, để không vượt giới hạn body.
  // Trùng khoá chính thì bỏ qua: nhập lại lần nữa không nhân đôi dữ liệu.
  app.post("/api/admin/transfer/import", requireAuth, requireAdmin, async (req, res) => {
    if (!isDbConfigured()) return res.status(503).json({ error: "DATABASE_URL chưa cấu hình." });
    const { table, rows } = req.body || {};
    if (!(TABLES as readonly string[]).includes(table)) {
      return res.status(400).json({ error: `Bảng không nằm trong danh sách cho phép: ${table}` });
    }
    if (!Array.isArray(rows)) return res.status(400).json({ error: "rows phải là mảng." });
    if (rows.length === 0) return res.json({ table, received: 0, inserted: 0, skipped: 0, failed: 0 });

    const t = tableOf(table);
    if (!t) return res.status(400).json({ error: `Không tìm thấy bảng ${table} trong schema.` });

    // Cột ngày giờ đi qua JSON thành chuỗi — Drizzle cần Date trở lại.
    const dateCols = Object.entries(t)
      .filter(([, col]: any) => col?.dataType === "date")
      .map(([key]) => key);
    const prepared = rows.map((row: any) => {
      const copy: any = { ...row };
      for (const c of dateCols) if (typeof copy[c] === "string") copy[c] = new Date(copy[c]);
      return copy;
    });

    let inserted = 0;
    let failed = 0;
    // Chèn từng dòng: một dòng hỏng (khoá ngoại trỏ sang bản ghi không mang
    // theo) không được làm hỏng cả lô.
    for (const row of prepared) {
      try {
        const done = (await getDb().insert(t).values(row).onConflictDoNothing().returning()) as any[];
        if (done.length > 0) inserted++;
      } catch {
        failed++;
      }
    }
    res.json({ table, received: rows.length, inserted, skipped: rows.length - inserted - failed, failed });
  });
}
