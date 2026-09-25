// Kho template meme + ảnh tham chiếu (assets). Mỗi asset phải có ảnh. Quyền:
// chủ sở hữu thấy asset của mình + mọi asset isShared; chỉ chủ mới sửa/xoá.
import type { Express } from "express";
import { and, desc, eq, or } from "drizzle-orm";
import { getDb, isDbConfigured } from "../db/client";
import { assets } from "../db/schema";
import { requireAuth, getAuthUser } from "../auth-mw";
import { storage, newKey, parseDataUrl, internalKeyFromUrl } from "../storage";
import { isActiveAdmin } from "./studio.routes";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KIND_VALUES = ["meme_template", "reference"] as const;

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

// Đính cờ isMine để FE biết asset nào của người dùng hiện tại (mới được sửa/xoá).
//
// `imageMissing`: dòng còn trong DB nhưng file ảnh đã mất (chuyển máy chủ, mất
// volume). Trước đây chỉ hiện ra một ô ảnh vỡ, không nói vì sao và không xoá
// được — nhất là khi asset của người khác chia sẻ cả nhóm.
async function withFlags(row: any, me: string) {
  const key = internalKeyFromUrl(row.imageUrl);
  const imageMissing = key ? !(await storage.exists(key)) : false;
  return { ...row, isMine: row.owner === me, imageMissing };
}

export function registerAssetRoutes(app: Express) {
  // GET /api/assets?kind=meme_template|reference — asset của mình HOẶC isShared.
  app.get("/api/assets", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const me = getAuthUser(req)!;
    const kind = typeof req.query.kind === "string" ? req.query.kind : "";
    try {
      const visible = or(eq(assets.owner, me), eq(assets.isShared, true));
      const where = KIND_VALUES.includes(kind as any) ? and(visible, eq(assets.kind, kind)) : visible;
      const rows = await getDb().select().from(assets).where(where).orderBy(desc(assets.createdAt));
      res.json(await Promise.all(rows.map((r) => withFlags(r, me))));
    } catch (e: any) {
      console.error("list assets:", e?.message || e);
      res.status(500).json({ error: "Lỗi tải kho tham chiếu." });
    }
  });

  // POST /api/assets — bắt buộc imageDataUrl (asset phải có ảnh).
  app.post("/api/assets", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const me = getAuthUser(req)!;
    const { kind, name, note, isShared, imageDataUrl } = req.body || {};
    if (typeof name !== "string" || !name.trim()) return res.status(400).json({ error: "Thiếu tên asset." });
    if (typeof imageDataUrl !== "string" || !imageDataUrl) return res.status(400).json({ error: "Thiếu ảnh (imageDataUrl)." });
    const parsed = parseDataUrl(imageDataUrl);
    if (!parsed) return res.status(400).json({ error: "Ảnh không hợp lệ (cần data:image base64)." });
    const kindValue = KIND_VALUES.includes(kind) ? kind : "reference";
    try {
      const key = newKey("assets", parsed.ext);
      await storage.put(key, parsed.buffer);
      const [row] = await getDb()
        .insert(assets)
        .values({
          owner: me,
          isShared: isShared === true,
          kind: kindValue,
          name: name.trim(),
          note: typeof note === "string" ? note : null,
          imageUrl: `/api/files/${key}`,
        })
        .returning();
      res.status(201).json(withFlags(row, me));
    } catch (e: any) {
      console.error("create asset:", e?.message || e);
      res.status(500).json({ error: "Lỗi lưu asset." });
    }
  });

  // PATCH /api/assets/:id — chỉ chủ sở hữu.
  app.patch("/api/assets/:id", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const me = getAuthUser(req)!;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "ID không hợp lệ." });
    try {
      const db = getDb();
      const [existing] = await db.select().from(assets).where(eq(assets.id, id));
      if (!existing) return res.status(404).json({ error: "Không tìm thấy asset." });
      if (existing.owner !== me) return res.status(403).json({ error: "Chỉ chủ sở hữu mới sửa được asset này." });

      const { name, note, isShared, imageDataUrl } = req.body || {};
      const patch: Record<string, any> = { updatedAt: new Date() };
      if (typeof name === "string" && name.trim()) patch.name = name.trim();
      if (typeof note === "string") patch.note = note;
      if (typeof isShared === "boolean") patch.isShared = isShared;

      let oldUrlToClean: string | null = null;
      if (typeof imageDataUrl === "string" && imageDataUrl) {
        const parsed = parseDataUrl(imageDataUrl);
        if (!parsed) return res.status(400).json({ error: "Ảnh không hợp lệ (cần data:image base64)." });
        const key = newKey("assets", parsed.ext);
        await storage.put(key, parsed.buffer);
        patch.imageUrl = `/api/files/${key}`;
        oldUrlToClean = existing.imageUrl;
      }

      const [row] = await db.update(assets).set(patch).where(eq(assets.id, id)).returning();
      if (oldUrlToClean) await deleteInternalImageIfAny(oldUrlToClean);
      res.json(withFlags(row, me));
    } catch (e: any) {
      console.error("update asset:", e?.message || e);
      res.status(500).json({ error: "Lỗi cập nhật asset." });
    }
  });

  // DELETE /api/assets/:id — chủ sở hữu, quản trị viên, hoặc bất kỳ ai khi ẢNH
  // ĐÃ MẤT (xoá cả file ảnh nội bộ).
  app.delete("/api/assets/:id", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const me = getAuthUser(req)!;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "ID không hợp lệ." });
    try {
      const db = getDb();
      const [existing] = await db.select().from(assets).where(eq(assets.id, id));
      if (!existing) return res.status(404).json({ error: "Không tìm thấy asset." });
      if (existing.owner !== me) {
        // Ảnh đã mất thì dòng dữ liệu chỉ còn là rác: không xem được, không vẽ
        // được, và người thấy nó thường không phải người tạo ra nó. Bắt đi tìm
        // chủ cũ để dọn rác là bắt làm một việc vô nghĩa.
        const key = internalKeyFromUrl(existing.imageUrl);
        const imageMissing = key ? !(await storage.exists(key)) : false;
        const isAdmin = await isActiveAdmin(me);
        if (!isAdmin && !imageMissing) {
          return res.status(403).json({
            error: `Ảnh này của "${existing.owner}" chia sẻ cho cả nhóm — chỉ chủ sở hữu hoặc quản trị viên mới xoá được.`,
          });
        }
      }
      await db.delete(assets).where(eq(assets.id, id));
      await deleteInternalImageIfAny(existing.imageUrl);
      res.json({ ok: true });
    } catch (e: any) {
      console.error("delete asset:", e?.message || e);
      res.status(500).json({ error: "Lỗi xoá asset." });
    }
  });
}
