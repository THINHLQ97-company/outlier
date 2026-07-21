// Lazy Postgres connection + Drizzle instance. The DB is optional at boot:
// the app must keep serving health-check + static routes even when
// DATABASE_URL is not configured (no crash — see PRD NFR + PLAN risks).
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

let _pool: Pool | null = null;
let _db: NodePgDatabase<typeof schema> | null = null;

export function isDbConfigured(): boolean {
  return !!process.env.DATABASE_URL;
}

export function getPool(): Pool {
  if (!_pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL chưa cấu hình — tính năng dữ liệu chưa khả dụng.");
    _pool = new Pool({ connectionString: url, max: 5 });
  }
  return _pool;
}

export function getDb(): NodePgDatabase<typeof schema> {
  if (!_db) _db = drizzle(getPool(), { schema });
  return _db;
}

export { schema };
