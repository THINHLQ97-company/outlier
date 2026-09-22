import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import dotenv from "dotenv";
import { runMigrations } from "./server/db/migrate";
import { seedAll } from "./server/db/seed";
import { isDbConfigured } from "./server/db/client";
import { registerAuthRoutes } from "./server/routes/auth.routes";
import { registerFileRoutes } from "./server/routes/files.routes";
import { registerCharacterRoutes } from "./server/routes/characters.routes";
import { registerSignalRoutes } from "./server/routes/signals.routes";
import { registerImageRoutes } from "./server/routes/images.routes";
import { registerPostRoutes } from "./server/routes/posts.routes";
import { registerUserRoutes } from "./server/routes/users.routes";
import { registerAssetRoutes } from "./server/routes/assets.routes";
import { registerStudioRoutes } from "./server/routes/studio.routes";
import { registerStyleRoutes } from "./server/routes/styles.routes";
import { registerBrandRoutes } from "./server/routes/brands.routes";
import { registerRadarRoutes } from "./server/routes/radar.routes";
import { registerDeconstructRoutes } from "./server/routes/deconstruct.routes";
import { registerRemakeRoutes } from "./server/routes/remakes.routes";
import { registerChannelRoutes } from "./server/routes/channels.routes";
import { registerVideoRoutes } from "./server/routes/videos.routes";
import { registerGalleryRoutes } from "./server/routes/gallery.routes";
import { registerRagRoutes } from "./server/routes/rag.routes";
import { registerMcpOAuthRoutes } from "./server/routes/mcp-oauth.routes";
import { registerMcpSignalsRoutes } from "./server/routes/mcp-signals.routes";
import { registerTransferRoutes } from "./server/routes/transfer.routes";

dotenv.config();

// Các tích hợp tuỳ chọn: thiếu thì app vẫn chạy, chỉ tắt tính năng tương ứng.
// Nhưng Vibe Host bắt buộc mọi biến trong .env.example phải có giá trị và từ
// chối cả chuỗi rỗng lẫn khoảng trắng, nên trên host ta điền sentinel "off".
// Xoá chúng ngay từ đầu để mọi chỗ kiểm tra `if (!process.env.X)` hiểu đúng.
const OPTIONAL_ENV_KEYS = [
  "GOOGLE_CLIENT_ID",
  "MARKET_RADAR_MCP_URL",
  "MARKET_RADAR_MCP_TOKEN",
  "GROUP_INSIGHTS_MCP_URL",
  "GROUP_INSIGHTS_MCP_TOKEN",
  "SOCIAL_BACKEND_URL",
  "SOCIAL_BACKEND_TOKEN",
  "FB_PAGE_ID",
  "FB_ACCESS_TOKEN",
];
// Host còn bắt các biến *_URL phải là URL hợp lệ, nên sentinel cho chúng là
// https://off.invalid/ (.invalid là TLD dành riêng, RFC 2606 — không phân giải).
const OFF_URL = "https://off.invalid";
for (const key of OPTIONAL_ENV_KEYS) {
  const value = (process.env[key] || "").trim().toLowerCase();
  if (value === "" || value === "off" || value.startsWith(OFF_URL)) {
    delete process.env[key];
  }
}

// Express serves Vite middleware in dev / dist/ in prod — same pattern as
// share-projects/marcow-crop's server.ts. Route registration (auth, signals,
// scripts, images, posts, characters) lands in later PLAN.md steps; this
// Step 1 skeleton only wires health-check + DB migration + static serving so
// the app boots and builds end-to-end from commit #1.
async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;

  app.use(express.json({ limit: "64mb" })); // 64mb: lô chuyển dữ liệu có ảnh base64

  // Run DB migrations on boot (no-op + warning if DATABASE_URL is unset, see
  // server/db/migrate.ts) so the app keeps serving even without Postgres yet.
  await runMigrations();

  // Seed sau migration: các bước seed đều bỏ qua nếu dữ liệu đã có. Cần chạy
  // ở đây vì Vibe Host không mở được shell để gọi `npm run db:seed` bằng tay,
  // mà không có bước này thì không tài khoản nào đăng nhập được.
  // Seed hỏng không được làm chết app — chỉ ghi log.
  if (isDbConfigured()) {
    try {
      await seedAll();
    } catch (e: any) {
      console.error("[boot] seed lỗi (bỏ qua, app vẫn chạy):", e?.message || e);
    }
  }

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // ===== AUTH (Step 3) =====
  registerAuthRoutes(app);
  registerTransferRoutes(app);

  // ===== FILES — serve ảnh reference nhân vật lưu ở storage nội bộ =====
  registerFileRoutes(app);

  // ===== CHARACTERS — thư viện nhân vật, CRUD đầy đủ (menu "Nhân vật") =====
  registerCharacterRoutes(app);

  // ===== SIGNALS (Step 4) — THU + LỌC =====
  registerSignalRoutes(app);

  // ===== SCRIPTS (Step 5) — DỊCH =====

  // ===== IMAGES (Step 5) — VẼ (generate + text-overlay + submit to DUYỆT) =====
  registerImageRoutes(app);

  // ===== POSTS (Step 6) — DUYỆT (kanban + checklist) + ĐĂNG (thủ công) =====
  registerPostRoutes(app);

  // ===== USERS — quản lý tài khoản (chỉ admin) =====
  registerUserRoutes(app);

  // ===== ASSETS — kho template meme + ảnh tham chiếu =====
  registerAssetRoutes(app);

  // ===== STUDIO — Vẽ tự do (sinh ảnh trực tiếp, không qua kịch bản) =====
  registerStudioRoutes(app);

  // ===== STYLES — thư viện phong cách vẽ (ảnh tham chiếu + mô tả JSON) =====
  registerStyleRoutes(app);

  // Brand Profile — hồ sơ thương hiệu có trích dẫn nguồn (docs/PRD.md §4 J1)
  registerBrandRoutes(app);

  // Radar — tìm bài đang bật lên trong ngách (docs/PRD.md §4 J2)
  registerRadarRoutes(app);

  // Bóc cấu trúc bài — vì sao bài đó giữ được người xem (docs/PRD.md §4 J3)
  registerDeconstructRoutes(app);

  // Viết lại cho brand + guardrail (docs/PRD.md §4 J4)
  registerRemakeRoutes(app);

  // Kênh theo dõi — xem đối thủ vừa đăng gì (docs/PRD.md §4 J2)
  registerChannelRoutes(app);

  // Dựng video từ bản viết (docs/PRD.md §4 J5)
  registerVideoRoutes(app);

  // ===== GALLERY — thư viện ảnh + lưu ảnh thành asset =====
  registerGalleryRoutes(app);

  // ===== RAG — kho "ảnh đã thích" (❤️) + hồ sơ sở thích để prompt thông minh hơn =====
  registerRagRoutes(app);

  // ===== MCP "Tín hiệu" — OAuth 2.1 AS + MCP server cho Claude (AI Analyst) =====
  // PHẢI đăng ký TRƯỚC SPA catch-all bên dưới để /.well-known/* + /api/oauth/* +
  // /api/mcp-signals không bị nuốt bởi index.html.
  registerMcpOAuthRoutes(app);
  registerMcpSignalsRoutes(app);

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
