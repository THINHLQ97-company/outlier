// RAG routes — kho "ảnh đã thích" (❤️) + hồ sơ sở thích.
//  POST   /api/rag/favorite        { postId, isShared? }  → thả tim 1 ảnh (lưu ví dụ + embedding)
//  DELETE /api/rag/by-post/:postId                        → bỏ tim ảnh của mình
//  GET    /api/rag/favorite-ids                           → [postId...] các ảnh mình đã tim (vẽ tim UI)
//  GET    /api/rag?scope=mine|shared|all                  → danh sách ví dụ RAG (Thư viện RAG)
//  DELETE /api/rag/:id                                    → xoá 1 ví dụ (chủ sở hữu / admin)
//  GET    /api/rag/profile                                → hồ sơ sở thích đã chưng cất
//  POST   /api/rag/profile/rebuild                        → chưng cất lại hồ sơ (từ ảnh đã thích)
import type { Express } from "express";
import { and, desc, eq, or } from "drizzle-orm";
import { getDb, isDbConfigured } from "../db/client";
import { posts, ragExamples, ragProfiles, users } from "../db/schema";
import { requireAuth, getAuthUser } from "../auth-mw";
import { embedTextGemini } from "../services/gemini-direct";
import { ragExampleToText, getRagProfile, rebuildRagProfile } from "../services/rag";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCOPES = ["mine", "shared", "all"] as const;

function dbDown(res: any): boolean {
  if (!isDbConfigured()) {
    res.status(503).json({ error: "Tính năng dữ liệu chưa khả dụng (thiếu DATABASE_URL)." });
    return true;
  }
  return false;
}

async function isActiveAdmin(db: any, username: string): Promise<boolean> {
  const [u] = await db.select().from(users).where(eq(users.username, username));
  return !!u && u.role === "admin" && u.isActive;
}

export function registerRagRoutes(app: Express) {
  // Thả tim 1 ảnh → tạo/ cập nhật 1 ví dụ RAG từ post (prompt + thông số + ảnh +
  // embedding). Idempotent theo (owner, postId): tim lại chỉ cập nhật isShared.
  app.post("/api/rag/favorite", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const me = getAuthUser(req)!;
    const { postId } = req.body || {};
    const isShared = req.body?.isShared === true;
    if (typeof postId !== "string" || !UUID_RE.test(postId)) return res.status(400).json({ error: "postId không hợp lệ." });
    try {
      const db = getDb();
      const [post] = await db.select().from(posts).where(eq(posts.id, postId));
      if (!post) return res.status(404).json({ error: "Không tìm thấy bài." });

      const imageUrl = post.finalImageUrl || post.selectedImageUrl || (post.imageVariants as any[])?.[0]?.url || null;
      if (!imageUrl) return res.status(400).json({ error: "Bài chưa có ảnh để thích." });

      const overlay = (post.overlayJson as any) || {};
      const debug = overlay.promptDebug || {};
      const sp = overlay.studioParams || {};
      const scene = post.promptText || "";
      const paramsJson: Record<string, any> = {
        styleName: debug.style || null,
        characters: Array.isArray(debug.characters) ? debug.characters : [],
        background: sp.background || null,
        panelLayout: sp.panelLayout || null,
        dialogue: Array.isArray(sp.dialogue) ? sp.dialogue : [],
        aspectRatio: overlay.aspectRatio || null,
      };

      // Đã tim trước đó? → cập nhật isShared, không tạo trùng.
      const [existing] = await db
        .select()
        .from(ragExamples)
        .where(and(eq(ragExamples.owner, me), eq(ragExamples.postId, postId)));
      if (existing) {
        const [row] = await db
          .update(ragExamples)
          .set({ isShared, imageUrl, scene, paramsJson, promptJson: debug.prompt || null })
          .where(eq(ragExamples.id, existing.id))
          .returning();
        return res.json({ ...row, isMine: true });
      }

      // Embedding (bỏ qua êm nếu thiếu key/lỗi — vẫn lưu ví dụ, chỉ không truy hồi được).
      let embedding: number[] | null = null;
      try {
        embedding = await embedTextGemini(ragExampleToText({ scene, paramsJson }));
      } catch (e: any) {
        console.warn(`[rag] embed khi thả tim lỗi (${e?.message || e}) — vẫn lưu, không có vector.`);
      }

      const [row] = await db
        .insert(ragExamples)
        .values({ owner: me, isShared, postId, scene, promptJson: debug.prompt || null, paramsJson, imageUrl, embedding })
        .returning();
      res.status(201).json({ ...row, isMine: true });
    } catch (e: any) {
      console.error("rag favorite:", e?.message || e);
      res.status(500).json({ error: "Thả tim thất bại." });
    }
  });

  // Bỏ tim (ảnh của chính mình).
  app.delete("/api/rag/by-post/:postId", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const me = getAuthUser(req)!;
    const { postId } = req.params;
    if (!UUID_RE.test(postId)) return res.status(400).json({ error: "postId không hợp lệ." });
    try {
      const db = getDb();
      await db.delete(ragExamples).where(and(eq(ragExamples.owner, me), eq(ragExamples.postId, postId)));
      res.json({ ok: true });
    } catch (e: any) {
      console.error("rag unfavorite:", e?.message || e);
      res.status(500).json({ error: "Bỏ tim thất bại." });
    }
  });

  // Danh sách postId mình đã tim (để vẽ trạng thái tim trên thư viện/Studio).
  app.get("/api/rag/favorite-ids", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const me = getAuthUser(req)!;
    try {
      const rows = await getDb()
        .select({ postId: ragExamples.postId })
        .from(ragExamples)
        .where(eq(ragExamples.owner, me));
      res.json(rows.map((r: any) => r.postId).filter(Boolean));
    } catch (e: any) {
      console.error("rag favorite-ids:", e?.message || e);
      res.status(500).json({ error: "Lỗi tải danh sách đã thích." });
    }
  });

  // Danh sách ví dụ RAG (Thư viện RAG). scope mặc định all (của mình + shared).
  app.get("/api/rag", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const me = getAuthUser(req)!;
    const scope = SCOPES.includes(req.query.scope as any) ? (req.query.scope as string) : "all";
    try {
      let where;
      if (scope === "mine") where = eq(ragExamples.owner, me);
      else if (scope === "shared") where = eq(ragExamples.isShared, true);
      else where = or(eq(ragExamples.owner, me), eq(ragExamples.isShared, true));
      const rows = await getDb()
        .select({
          id: ragExamples.id,
          owner: ragExamples.owner,
          isShared: ragExamples.isShared,
          postId: ragExamples.postId,
          scene: ragExamples.scene,
          paramsJson: ragExamples.paramsJson,
          imageUrl: ragExamples.imageUrl,
          createdAt: ragExamples.createdAt,
        })
        .from(ragExamples)
        .where(where)
        .orderBy(desc(ragExamples.createdAt));
      res.json(rows.map((r: any) => ({ ...r, isMine: r.owner === me })));
    } catch (e: any) {
      console.error("rag list:", e?.message || e);
      res.status(500).json({ error: "Lỗi tải thư viện RAG." });
    }
  });

  // Xoá 1 ví dụ RAG (chủ sở hữu hoặc admin).
  app.delete("/api/rag/:id", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const me = getAuthUser(req)!;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "ID không hợp lệ." });
    try {
      const db = getDb();
      const [row] = await db.select().from(ragExamples).where(eq(ragExamples.id, id));
      if (!row) return res.status(404).json({ error: "Không tìm thấy ví dụ." });
      if (row.owner !== me && !(await isActiveAdmin(db, me))) {
        return res.status(403).json({ error: "Chỉ người tạo (hoặc quản trị) mới xoá được." });
      }
      await db.delete(ragExamples).where(eq(ragExamples.id, id));
      res.json({ ok: true });
    } catch (e: any) {
      console.error("rag delete:", e?.message || e);
      res.status(500).json({ error: "Xoá ví dụ thất bại." });
    }
  });

  // Hồ sơ sở thích đã chưng cất.
  app.get("/api/rag/profile", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const me = getAuthUser(req)!;
    try {
      const db = getDb();
      const [row] = await db.select().from(ragProfiles).where(eq(ragProfiles.owner, me));
      res.json({
        profileText: row?.profileText || null,
        exampleCount: row?.exampleCount || 0,
        updatedAt: row?.updatedAt || null,
      });
    } catch (e: any) {
      console.error("rag profile:", e?.message || e);
      res.status(500).json({ error: "Lỗi tải hồ sơ RAG." });
    }
  });

  // Chưng cất lại hồ sơ sở thích từ các ảnh đã thích (mình + shared).
  app.post("/api/rag/profile/rebuild", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const me = getAuthUser(req)!;
    try {
      const result = await rebuildRagProfile(getDb(), me);
      res.json(result);
    } catch (e: any) {
      console.error("rag rebuild:", e?.message || e);
      res.status(500).json({ error: "Cập nhật hồ sơ RAG thất bại." });
    }
  });
}

// re-export để index/registrar dùng nếu cần đọc profile ở nơi khác.
export { getRagProfile };
