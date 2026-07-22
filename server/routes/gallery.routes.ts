// Thư viện ảnh (gallery) — các post đã có ảnh, kèm trục (COALESCE post/script),
// origin, owner, isShared. Cho phép lưu ảnh cuối 1 post thành asset tham chiếu.
import type { Express } from "express";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { getDb, isDbConfigured } from "../db/client";
import { posts, scripts, assets, users } from "../db/schema";
import { requireAuth, getAuthUser } from "../auth-mw";
import { storage, newKey, internalKeyFromUrl } from "../storage";

// Dọn mọi file ảnh nội bộ của 1 post (biến thể + ảnh đã chọn + ảnh cuối).
async function deletePostFiles(post: any) {
  const urls = [
    ...((post.imageVariants || []) as any[]).map((v) => v?.url),
    post.selectedImageUrl,
    post.finalImageUrl,
  ];
  for (const url of urls) {
    const key = internalKeyFromUrl(url);
    if (key) await storage.delete(key).catch(() => {});
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KIND_VALUES = ["meme_template", "reference"] as const;
const SCOPES = ["mine", "shared", "all"] as const;

function dbDown(res: any): boolean {
  if (!isDbConfigured()) {
    res.status(503).json({ error: "Tính năng dữ liệu chưa khả dụng (thiếu DATABASE_URL)." });
    return true;
  }
  return false;
}

export function registerGalleryRoutes(app: Express) {
  // GET /api/gallery?scope=mine|shared|all (mặc định all).
  app.get("/api/gallery", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const me = getAuthUser(req)!;
    const scope = SCOPES.includes(req.query.scope as any) ? (req.query.scope as string) : "all";
    try {
      // Chỉ lấy post đã có ảnh (finalImageUrl not null HOẶC imageVariants không rỗng).
      const hasImage = sql`(${posts.finalImageUrl} is not null or coalesce(jsonb_array_length(${posts.imageVariants}), 0) > 0)`;
      let visibility;
      if (scope === "mine") visibility = eq(posts.owner, me);
      else if (scope === "shared") visibility = eq(posts.isShared, true);
      else visibility = or(eq(posts.owner, me), eq(posts.isShared, true));

      const rows = await getDb()
        .select({
          id: posts.id,
          origin: posts.origin,
          owner: posts.owner,
          isShared: posts.isShared,
          status: posts.status,
          truc: sql<string | null>`coalesce(${posts.truc}, ${scripts.truc})`,
          finalImageUrl: posts.finalImageUrl,
          selectedImageUrl: posts.selectedImageUrl,
          imageVariants: posts.imageVariants,
          caption: posts.caption,
          createdAt: posts.createdAt,
        })
        .from(posts)
        .leftJoin(scripts, eq(posts.scriptId, scripts.id))
        .where(and(hasImage, visibility))
        .orderBy(desc(posts.createdAt));
      res.json(rows.map((r) => ({ ...r, isMine: r.owner === me })));
    } catch (e: any) {
      console.error("gallery:", e?.message || e);
      res.status(500).json({ error: "Lỗi tải thư viện ảnh." });
    }
  });

  // POST /api/gallery/:postId/save-as-asset — copy ảnh cuối của post sang assets.
  app.post("/api/gallery/:postId/save-as-asset", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const me = getAuthUser(req)!;
    const { postId } = req.params;
    if (!UUID_RE.test(postId)) return res.status(400).json({ error: "ID không hợp lệ." });
    const { name, kind, isShared } = req.body || {};
    if (typeof name !== "string" || !name.trim()) return res.status(400).json({ error: "Thiếu tên asset." });
    const kindValue = KIND_VALUES.includes(kind) ? kind : "reference";
    try {
      const db = getDb();
      const [post] = await db.select().from(posts).where(eq(posts.id, postId));
      if (!post) return res.status(404).json({ error: "Không tìm thấy bài." });

      const sourceUrl = post.finalImageUrl || post.selectedImageUrl;
      const sourceKey = internalKeyFromUrl(sourceUrl);
      if (!sourceKey) return res.status(400).json({ error: "Bài chưa có ảnh nội bộ để lưu làm asset." });

      let buf: Buffer;
      try {
        buf = await storage.get(sourceKey);
      } catch {
        return res.status(400).json({ error: "Không đọc được file ảnh của bài." });
      }
      const ext = sourceKey.split(".").pop() || "png";
      const newAssetKey = newKey("assets", ext);
      await storage.put(newAssetKey, buf);

      const [row] = await db
        .insert(assets)
        .values({
          owner: me,
          isShared: isShared === true,
          kind: kindValue,
          name: name.trim(),
          imageUrl: `/api/files/${newAssetKey}`,
          note: null,
        })
        .returning();
      res.status(201).json({ ...row, isMine: true });
    } catch (e: any) {
      console.error("save-as-asset:", e?.message || e);
      res.status(500).json({ error: "Lưu ảnh thành asset thất bại." });
    }
  });

  // DELETE /api/gallery/:postId — xoá 1 ảnh khỏi thư viện. Chỉ chủ sở hữu (owner)
  // hoặc admin. Xoá cả file ảnh nội bộ để không rác storage.
  app.delete("/api/gallery/:postId", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const me = getAuthUser(req)!;
    const { postId } = req.params;
    if (!UUID_RE.test(postId)) return res.status(400).json({ error: "ID không hợp lệ." });
    try {
      const db = getDb();
      const [post] = await db.select().from(posts).where(eq(posts.id, postId));
      if (!post) return res.status(404).json({ error: "Không tìm thấy ảnh." });

      const [user] = await db.select().from(users).where(eq(users.username, me));
      const isAdmin = user?.role === "admin" && user?.isActive;
      if (post.owner !== me && !isAdmin) {
        return res.status(403).json({ error: "Chỉ người tạo (hoặc quản trị) mới xoá được ảnh này." });
      }

      await db.delete(posts).where(eq(posts.id, postId));
      await deletePostFiles(post);
      res.json({ ok: true });
    } catch (e: any) {
      console.error("delete gallery:", e?.message || e);
      res.status(500).json({ error: "Xoá ảnh thất bại." });
    }
  });
}
