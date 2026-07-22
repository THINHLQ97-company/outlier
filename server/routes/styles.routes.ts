// Thư viện phong cách vẽ (styles) — mỗi phong cách = ẢNH THAM CHIẾU + mô tả JSON
// (styleJson). Khi tạo nội dung, ảnh phong cách + styleJson được đính vào prompt
// (buildImageGenerationRequest) để Gemini vẽ ĐỒNG BỘ phong cách.
//
// Quyền: xem = owner==user | isShared | isDefault. Sửa/xoá phong cách của mình
// (owner). Phong cách isDefault (seed, owner="system") chỉ admin sửa/xoá được.
// Sinh ảnh minh hoạ (generate-reference) cho phép với mọi phong cách xem được
// (kể cả isDefault) để bất kỳ user nào cũng "xem thử" phong cách mặc định.
//
// Thiếu GEMINI_API_KEY / lỗi phân tích ảnh khi tạo → styleJson rỗng + warning,
// KHÔNG crash (CLAUDE.md mục 3). Sinh ảnh minh hoạ thiếu key → 502 rõ ràng.
import type { Express } from "express";
import { and, desc, eq, or } from "drizzle-orm";
import { getDb, isDbConfigured } from "../db/client";
import { styles } from "../db/schema";
import { requireAuth, getAuthUser } from "../auth-mw";
import { storage, newKey, parseDataUrl, internalKeyFromUrl } from "../storage";
import { analyzeImageGemini, generateImageGemini, GeminiError } from "../services/gemini-direct";
import { isActiveAdmin } from "./studio.routes";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Các khoá mô tả phong cách mà Gemini phân tích ảnh phải trả về.
const STYLE_FIELDS = ["medium", "linework", "shading", "color_palette", "effects", "mood", "distinctive_traits"];

function dbDown(res: any): boolean {
  if (!isDbConfigured()) {
    res.status(503).json({ error: "Tính năng dữ liệu chưa khả dụng (thiếu DATABASE_URL)." });
    return true;
  }
  return false;
}

async function deleteInternalImageIfAny(url: string | null | undefined) {
  const key = internalKeyFromUrl(url);
  if (key) await storage.delete(key).catch(() => {});
}

// Phân tích 1 ảnh phong cách → styleJson có cấu trúc. Lỗi/thiếu key → { styleJson
// rỗng, warning } (KHÔNG throw) để tạo phong cách vẫn thành công, người dùng bổ
// sung mô tả sau.
async function analyzeStyleImage(image: { mimeType: string; data: string }): Promise<{ styleJson: Record<string, any>; warning?: string }> {
  const prompt = `You are an art director. Analyze the attached illustration and describe its DRAWING STYLE (not its content) as a compact JSON object with EXACTLY these string fields: ${STYLE_FIELDS.join(
    ", "
  )}. Each value is a short English phrase. "distinctive_traits" summarizes what makes this style recognizable. Return ONLY the JSON object.`;
  try {
    const text = await analyzeImageGemini(prompt, image);
    const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
    const styleJson: Record<string, any> = {};
    for (const f of STYLE_FIELDS) {
      if (parsed && parsed[f] != null) styleJson[f] = parsed[f];
    }
    if (Object.keys(styleJson).length === 0) throw new Error("Phân tích không có trường hợp lệ.");
    return { styleJson };
  } catch (e: any) {
    const warning = `[styles] Phân tích phong cách thất bại (${e?.message || e}) — lưu phong cách với mô tả rỗng, hãy bổ sung sau.`;
    console.warn(warning);
    return { styleJson: {}, warning };
  }
}

export function registerStyleRoutes(app: Express) {
  // GET /api/styles — phong cách xem được, kèm isMine + imageMissing.
  app.get("/api/styles", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const me = getAuthUser(req)!;
    try {
      const rows = await getDb()
        .select()
        .from(styles)
        .where(or(eq(styles.owner, me), eq(styles.isShared, true), eq(styles.isDefault, true)))
        .orderBy(desc(styles.isDefault), desc(styles.createdAt));
      const withStatus = await Promise.all(
        rows.map(async (r) => {
          const key = internalKeyFromUrl(r.referenceImageUrl);
          const imageMissing = key ? !(await storage.exists(key)) : false;
          return { ...r, isMine: r.owner === me, imageMissing };
        })
      );
      res.json(withStatus);
    } catch (e: any) {
      console.error("list styles:", e?.message || e);
      res.status(500).json({ error: "Lỗi tải thư viện phong cách." });
    }
  });

  // POST /api/styles {name, isShared?, imageDataUrl} — lưu ảnh → phân tích styleJson.
  app.post("/api/styles", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const me = getAuthUser(req)!;
    const { name, isShared, imageDataUrl } = req.body || {};
    if (typeof name !== "string" || !name.trim()) return res.status(400).json({ error: "Thiếu tên phong cách." });
    if (typeof imageDataUrl !== "string" || !imageDataUrl) return res.status(400).json({ error: "Thiếu ảnh phong cách (imageDataUrl)." });
    const parsed = parseDataUrl(imageDataUrl);
    if (!parsed) return res.status(400).json({ error: "Ảnh không hợp lệ (cần data:image base64)." });
    try {
      const key = newKey("styles", parsed.ext);
      await storage.put(key, parsed.buffer);
      const referenceImageUrl = `/api/files/${key}`;

      const { styleJson, warning } = await analyzeStyleImage({
        mimeType: `image/${parsed.ext === "jpg" ? "jpeg" : parsed.ext}`,
        data: parsed.buffer.toString("base64"),
      });

      const [row] = await getDb()
        .insert(styles)
        .values({
          owner: me,
          isShared: isShared === true,
          isDefault: false,
          name: name.trim(),
          styleJson,
          referenceImageUrl,
        })
        .returning();
      res.status(201).json({ ...row, isMine: true, imageMissing: false, warning });
    } catch (e: any) {
      console.error("create style:", e?.message || e);
      res.status(500).json({ error: "Lỗi lưu phong cách." });
    }
  });

  // PATCH /api/styles/:id {name?,isShared?,styleJson?,imageDataUrl?}.
  app.patch("/api/styles/:id", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const me = getAuthUser(req)!;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "ID không hợp lệ." });
    try {
      const db = getDb();
      const [existing] = await db.select().from(styles).where(eq(styles.id, id));
      if (!existing) return res.status(404).json({ error: "Không tìm thấy phong cách." });
      // isDefault chỉ admin sửa; còn lại chủ sở hữu.
      if (existing.isDefault) {
        if (!(await isActiveAdmin(me))) return res.status(403).json({ error: "Chỉ admin mới sửa được phong cách mặc định." });
      } else if (existing.owner !== me) {
        return res.status(403).json({ error: "Chỉ chủ sở hữu mới sửa được phong cách này." });
      }

      const { name, isShared, styleJson, imageDataUrl } = req.body || {};
      const patch: Record<string, any> = { updatedAt: new Date() };
      if (typeof name === "string" && name.trim()) patch.name = name.trim();
      if (typeof isShared === "boolean") patch.isShared = isShared;
      if (styleJson && typeof styleJson === "object" && !Array.isArray(styleJson)) patch.styleJson = styleJson;

      let oldUrlToClean: string | null = null;
      let warning: string | undefined;
      if (typeof imageDataUrl === "string" && imageDataUrl) {
        const parsed = parseDataUrl(imageDataUrl);
        if (!parsed) return res.status(400).json({ error: "Ảnh không hợp lệ (cần data:image base64)." });
        const key = newKey("styles", parsed.ext);
        await storage.put(key, parsed.buffer);
        patch.referenceImageUrl = `/api/files/${key}`;
        oldUrlToClean = existing.referenceImageUrl;
        // Thay ảnh → phân tích lại (trừ khi client đã tự gửi styleJson).
        if (!patch.styleJson) {
          const analyzed = await analyzeStyleImage({
            mimeType: `image/${parsed.ext === "jpg" ? "jpeg" : parsed.ext}`,
            data: parsed.buffer.toString("base64"),
          });
          patch.styleJson = analyzed.styleJson;
          warning = analyzed.warning;
        }
      }

      const [row] = await db.update(styles).set(patch).where(eq(styles.id, id)).returning();
      if (oldUrlToClean && oldUrlToClean !== patch.referenceImageUrl) await deleteInternalImageIfAny(oldUrlToClean);
      res.json({ ...row, isMine: row.owner === me, warning });
    } catch (e: any) {
      console.error("update style:", e?.message || e);
      res.status(500).json({ error: "Lỗi cập nhật phong cách." });
    }
  });

  // DELETE /api/styles/:id — chủ sở hữu; isDefault chỉ admin.
  app.delete("/api/styles/:id", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const me = getAuthUser(req)!;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "ID không hợp lệ." });
    try {
      const db = getDb();
      const [existing] = await db.select().from(styles).where(eq(styles.id, id));
      if (!existing) return res.status(404).json({ error: "Không tìm thấy phong cách." });
      if (existing.isDefault) {
        if (!(await isActiveAdmin(me))) return res.status(403).json({ error: "Chỉ admin mới xoá được phong cách mặc định." });
      } else if (existing.owner !== me) {
        return res.status(403).json({ error: "Chỉ chủ sở hữu mới xoá được phong cách này." });
      }
      await db.delete(styles).where(eq(styles.id, id));
      await deleteInternalImageIfAny(existing.referenceImageUrl);
      res.json({ ok: true });
    } catch (e: any) {
      console.error("delete style:", e?.message || e);
      res.status(500).json({ error: "Lỗi xoá phong cách." });
    }
  });

  // POST /api/styles/:id/generate-reference — sinh ẢNH minh hoạ từ styleJson
  // (cảnh mẫu đơn giản render đúng phong cách), lưu storage, set referenceImageUrl.
  // Cho phép với phong cách xem được (kể cả isDefault). Thiếu key → 502 rõ ràng.
  app.post("/api/styles/:id/generate-reference", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const me = getAuthUser(req)!;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "ID không hợp lệ." });
    try {
      const db = getDb();
      const [existing] = await db.select().from(styles).where(eq(styles.id, id));
      if (!existing) return res.status(404).json({ error: "Không tìm thấy phong cách." });
      // Xem được = owner | isShared | isDefault.
      const canView = existing.owner === me || existing.isShared || existing.isDefault;
      if (!canView) return res.status(403).json({ error: "Bạn không có quyền với phong cách này." });

      const descriptor = JSON.stringify(existing.styleJson || {}, null, 2);
      const prompt = `You are an AI comic illustration engine. Draw a SIMPLE sample scene — one friendly cartoon character waving in a plain setting — rendered EXACTLY in the following art style. Follow this style descriptor precisely:

${descriptor}

Art style name: ${existing.name}. Single illustrated panel, clean composition. Absolutely NO text, letters or watermark in the image.`;

      let dataUrl: string;
      try {
        dataUrl = await generateImageGemini(prompt, undefined, "1:1");
      } catch (e: any) {
        const message = e instanceof GeminiError ? e.message : "Sinh ảnh minh hoạ thất bại.";
        return res.status(502).json({ error: message });
      }

      const parsed = parseDataUrl(dataUrl);
      if (!parsed) return res.status(502).json({ error: "Gemini trả về ảnh không hợp lệ." });
      const key = newKey("styles", parsed.ext);
      await storage.put(key, parsed.buffer);
      const referenceImageUrl = `/api/files/${key}`;

      const [row] = await db
        .update(styles)
        .set({ referenceImageUrl, updatedAt: new Date() })
        .where(eq(styles.id, id))
        .returning();
      await deleteInternalImageIfAny(existing.referenceImageUrl);
      res.json({ ...row, isMine: row.owner === me, imageMissing: false });
    } catch (e: any) {
      console.error("generate style reference:", e?.message || e);
      res.status(500).json({ error: "Lỗi sinh ảnh minh hoạ phong cách." });
    }
  });
}
