import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import dotenv from "dotenv";
import { runMigrations } from "./server/db/migrate";

dotenv.config();

// Express serves Vite middleware in dev / dist/ in prod — same pattern as
// share-projects/marcow-crop's server.ts. Route registration (auth, signals,
// scripts, images, posts, characters) lands in later PLAN.md steps; this
// Step 1 skeleton only wires health-check + DB migration + static serving so
// the app boots and builds end-to-end from commit #1.
async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;

  app.use(express.json({ limit: "10mb" }));

  // Run DB migrations on boot (no-op + warning if DATABASE_URL is unset, see
  // server/db/migrate.ts) so the app keeps serving even without Postgres yet.
  await runMigrations();

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // ===== ROUTES (registered progressively in later steps) =====
  // registerAuthRoutes(app)      — Step 3
  // registerSignalRoutes(app)    — Step 4 (THU + LỌC)
  // registerScriptRoutes(app)    — Step 5 (DỊCH)
  // registerImageRoutes(app)     — Step 5 (VẼ)
  // registerPostRoutes(app)      — Step 6 (DUYỆT + ĐĂNG)
  // registerCharacterRoutes(app) — Step 3/4

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
