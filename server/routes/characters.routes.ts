// Character reference library — CRUD đầy đủ (menu "Nhân vật", xem CLAUDE.md).
// Dàn nhân vật cố định (Gàn, Gèn, Chị Bão, Sếp + 5 AI + Cơn Bão) vẫn seed sẵn
// (server/db/seed.ts, shared/engine-data.ts) — CRUD cho phép thêm nhân vật
// phụ/thử nghiệm và cập nhật ảnh reference, KHÔNG tự ý đổi tính cách 9 nhân
// vật gốc (ràng buộc cứng CLAUDE.md mục 1) trừ khi user chủ động sửa qua UI.
import type { Express } from "express";
import { desc, eq } from "drizzle-orm";
import { getDb, isDbConfigured } from "../db/client";
import { characters } from "../db/schema";
import { requireAuth } from "../auth-mw";
import { storage, newKey, parseDataUrl, internalKeyFromUrl } from "../storage";
import { generateImageGemini, GeminiError } from "../services/gemini-direct";
import { STYLE_PROMPT } from "../../shared/engine-data";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KIND_VALUES = ["nguoi", "ai", "linh_vat"] as const;

function dbDown(res: any): boolean {
  if (!isDbConfigured()) {
    res.status(503).json({ error: "Tính năng dữ liệu chưa khả dụng (thiếu DATABASE_URL)." });
    return true;
  }
  return false;
}

// Xoá file ảnh cũ khỏi storage nội bộ nếu referenceImageUrl trỏ vào đó —
// không đụng tới nếu là URL ngoài (đã ghi rõ trong storage.ts).
async function deleteInternalImageIfAny(url: string | null | undefined) {
  const key = internalKeyFromUrl(url);
  if (key) await storage.delete(key).catch(() => {});
}

export function registerCharacterRoutes(app: Express) {
  app.get("/api/characters", requireAuth, async (_req, res) => {
    if (!isDbConfigured()) {
      // Fallback: chưa có DB (demo môi trường trống) — trả về dữ liệu tĩnh
      // từ shared/engine-data.ts thay vì lỗi 503, để UI vẫn dùng được.
      console.warn("[characters] DATABASE_URL chưa cấu hình — trả về dữ liệu tĩnh demo.");
      const { CHARACTERS } = await import("../../shared/engine-data");
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
          updatedAt: new Date().toISOString(),
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

  // Tạo nhân vật mới.
  app.post("/api/characters", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { name, kind, promptDescription, personality, catchphrase, refImageDataUrl } = req.body || {};
    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "Thiếu tên nhân vật." });
    }
    if (typeof promptDescription !== "string" || !promptDescription.trim()) {
      return res.status(400).json({ error: "Thiếu mô tả prompt (promptDescription)." });
    }
    const kindValue = KIND_VALUES.includes(kind) ? kind : "nguoi";

    try {
      let referenceImageUrl: string | null = null;
      if (typeof refImageDataUrl === "string" && refImageDataUrl) {
        const parsed = parseDataUrl(refImageDataUrl);
        if (!parsed) return res.status(400).json({ error: "Ảnh tham chiếu không hợp lệ." });
        const key = newKey("characters", parsed.ext);
        await storage.put(key, parsed.buffer);
        referenceImageUrl = `/api/files/${key}`;
      }
      const [row] = await getDb()
        .insert(characters)
        .values({
          name: name.trim(),
          kind: kindValue,
          promptDescription: promptDescription.trim(),
          personality: typeof personality === "string" ? personality : null,
          catchphrase: typeof catchphrase === "string" ? catchphrase : null,
          referenceImageUrl,
        })
        .returning();
      res.status(201).json(row);
    } catch (e: any) {
      console.error("create character:", e?.message || e);
      res.status(500).json({ error: "Lỗi lưu nhân vật." });
    }
  });

  // Sửa nhân vật — field thường + optional refImageDataUrl (upload thủ công).
  app.patch("/api/characters/:id", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "ID không hợp lệ." });
    try {
      const db = getDb();
      const [existing] = await db.select().from(characters).where(eq(characters.id, id));
      if (!existing) return res.status(404).json({ error: "Không tìm thấy nhân vật." });

      const { name, kind, promptDescription, personality, catchphrase, refImageDataUrl } = req.body || {};
      const patch: Record<string, any> = { updatedAt: new Date() };
      if (typeof name === "string" && name.trim()) patch.name = name.trim();
      if (KIND_VALUES.includes(kind)) patch.kind = kind;
      if (typeof promptDescription === "string" && promptDescription.trim()) patch.promptDescription = promptDescription.trim();
      if (typeof personality === "string") patch.personality = personality;
      if (typeof catchphrase === "string") patch.catchphrase = catchphrase;

      let oldUrlToClean: string | null = null;
      if (typeof refImageDataUrl === "string" && refImageDataUrl) {
        const parsed = parseDataUrl(refImageDataUrl);
        if (!parsed) return res.status(400).json({ error: "Ảnh tham chiếu không hợp lệ." });
        const key = newKey("characters", parsed.ext);
        await storage.put(key, parsed.buffer);
        patch.referenceImageUrl = `/api/files/${key}`;
        oldUrlToClean = existing.referenceImageUrl;
      }

      const [row] = await db.update(characters).set(patch).where(eq(characters.id, id)).returning();
      if (oldUrlToClean) await deleteInternalImageIfAny(oldUrlToClean);
      res.json(row);
    } catch (e: any) {
      console.error("update character:", e?.message || e);
      res.status(500).json({ error: "Lỗi cập nhật nhân vật." });
    }
  });

  // Xoá nhân vật (+ ảnh reference nếu lưu ở storage nội bộ).
  app.delete("/api/characters/:id", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "ID không hợp lệ." });
    try {
      const db = getDb();
      const [existing] = await db.select().from(characters).where(eq(characters.id, id));
      if (!existing) return res.status(404).json({ error: "Không tìm thấy nhân vật." });
      await db.delete(characters).where(eq(characters.id, id));
      await deleteInternalImageIfAny(existing.referenceImageUrl);
      res.json({ ok: true });
    } catch (e: any) {
      console.error("delete character:", e?.message || e);
      res.status(500).json({ error: "Lỗi xoá nhân vật." });
    }
  });

  // AI vẽ ảnh reference mới từ promptDescription (đường CTA "AI vẽ ảnh").
  // Gọi Gemini trực tiếp (server/services/gemini-direct.ts) — thiếu
  // GEMINI_API_KEY hoặc lỗi gọi API → 502 với message rõ ràng, KHÔNG crash
  // server (giữ đúng pattern CLAUDE.md mục 3).
  app.post("/api/characters/:id/generate-reference", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "ID không hợp lệ." });
    try {
      const db = getDb();
      const [existing] = await db.select().from(characters).where(eq(characters.id, id));
      if (!existing) return res.status(404).json({ error: "Không tìm thấy nhân vật." });

      const prompt = `${STYLE_PROMPT}\n\nCharacter reference sheet, single character, plain neutral background, front-facing, full body or waist-up, clean lines, no text.\n\n${existing.name}: ${existing.promptDescription}`;

      let dataUrl: string;
      try {
        dataUrl = await generateImageGemini(prompt, undefined, "3:4");
      } catch (e: any) {
        const message = e instanceof GeminiError ? e.message : "Sinh ảnh AI thất bại.";
        return res.status(502).json({ error: message });
      }

      const parsed = parseDataUrl(dataUrl);
      if (!parsed) return res.status(502).json({ error: "Gemini trả về ảnh không hợp lệ." });
      const key = newKey("characters", parsed.ext);
      await storage.put(key, parsed.buffer);
      const referenceImageUrl = `/api/files/${key}`;

      const [row] = await db
        .update(characters)
        .set({ referenceImageUrl, updatedAt: new Date() })
        .where(eq(characters.id, id))
        .returning();
      await deleteInternalImageIfAny(existing.referenceImageUrl);
      res.json(row);
    } catch (e: any) {
      console.error("generate character reference:", e?.message || e);
      res.status(500).json({ error: "Lỗi sinh ảnh reference." });
    }
  });
}
