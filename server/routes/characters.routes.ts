// Character reference library — read-only trong iMVP (FR4.1). 5 nhân vật +
// 5 AI + linh vật được seed sẵn (server/db/seed.ts); referenceImageUrl để
// trống cho tới khi có Gemini API key thật để generate ảnh nhân vật.
import type { Express } from "express";
import { desc } from "drizzle-orm";
import { getDb, isDbConfigured } from "../db/client";
import { characters } from "../db/schema";
import { requireAuth } from "../auth-mw";
import { CHARACTERS } from "../../shared/engine-data";

export function registerCharacterRoutes(app: Express) {
  app.get("/api/characters", requireAuth, async (_req, res) => {
    if (!isDbConfigured()) {
      // Fallback: chưa có DB (demo môi trường trống) — trả về dữ liệu tĩnh
      // từ shared/engine-data.ts thay vì lỗi 503, để UI vẫn dùng được.
      console.warn("[characters] DATABASE_URL chưa cấu hình — trả về dữ liệu tĩnh demo.");
      return res.json(
        CHARACTERS.map((c, i) => ({
          id: `demo-${i}`,
          name: c.name,
          kind: c.kind,
          promptDescription: c.promptDescription,
          personality: c.personality,
          catchphrase: c.catchphrase ?? null,
          referenceImageUrl: null,
          createdAt: new Date().toISOString(),
        }))
      );
    }
    try {
      const rows = await getDb().select().from(characters).orderBy(desc(characters.createdAt));
      res.json(rows);
    } catch (e: any) {
      console.error("list characters:", e?.message || e);
      res.status(500).json({ error: "Lỗi tải thư viện nhân vật." });
    }
  });
}
