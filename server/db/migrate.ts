// Runs versioned migrations from server/db/migrations on startup. Safe to
// call when DATABASE_URL is missing (no-ops with a warning) so the rest of
// the app keeps working (health check, static assets, demo-mode routes).
import path from "path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb, isDbConfigured } from "./client";

const MIGRATIONS_DIR = path.join(process.cwd(), "server", "db", "migrations");

export async function runMigrations(): Promise<void> {
  if (!isDbConfigured()) {
    console.warn("[db] DATABASE_URL chưa set — bỏ qua migrate, tính năng dữ liệu tắt.");
    return;
  }
  try {
    await migrate(getDb(), { migrationsFolder: MIGRATIONS_DIR });
    console.log("[db] Migrations applied OK.");
  } catch (err: any) {
    // Don't crash the whole server — keep existing routes alive.
    console.error("[db] Migration FAILED:", err?.message || err);
  }
}
