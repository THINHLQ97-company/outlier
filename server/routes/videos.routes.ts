// Dựng video từ bản viết (docs/PRD.md §4 J5).
//
// Quy trình chia bước CÓ ĐIỂM DỪNG vì bước sinh hình tốn tiền thật:
//   1. POST /api/videos            — tạo dự án + tách cảnh (rẻ, Gemini text)
//   2. người dùng sửa/duyệt cảnh   — PATCH từng cảnh
//   3. POST /api/videos/:id/generate — sinh hình bằng Veo (TỐN TIỀN, phải xác nhận)
//   4. POST /api/videos/:id/render   — ghép bằng ffmpeg (miễn phí)
import type { Express } from "express";
import fs from "fs";
import os from "os";
import path from "path";
import { asc, desc, eq } from "drizzle-orm";
import { getDb, isDbConfigured } from "../db/client";
import { videoProjects, videoScenes, remakes } from "../db/schema";
import { requireAuth, getAuthUser } from "../auth-mw";
import { splitIntoScenes, estimateSceneCostUsd, concatClips, MAX_SCENES, USD_PER_SCENE, hasFfmpeg } from "../services/video-build";
import { generateVideo } from "../services/veo";
import { storage, newKey } from "../storage";
import { isActiveAdmin } from "./studio.routes";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function dbDown(res: any): boolean {
  if (!isDbConfigured()) {
    res.status(503).json({ error: "Tính năng dữ liệu chưa khả dụng (thiếu DATABASE_URL)." });
    return true;
  }
  return false;
}

async function canTouch(req: any, row: { owner: string }): Promise<boolean> {
  const u = getAuthUser(req);
  if (!u) return false;
  return row.owner === u || (await isActiveAdmin(u));
}

/** Bước 1 chạy nền: tách kịch bản thành cảnh. */
export async function runSplitInBackground(projectId: string, script: string) {
  try {
    await getDb().update(videoProjects).set({ status: "splitting", updatedAt: new Date() }).where(eq(videoProjects.id, projectId));
    const r = await splitIntoScenes(script);
    if (r.scenes.length === 0) {
      await getDb().update(videoProjects)
        .set({ status: "error", errorMessage: r.warning || "Không tách được cảnh nào.", updatedAt: new Date() })
        .where(eq(videoProjects.id, projectId));
      return;
    }
    await getDb().insert(videoScenes).values(r.scenes.map((s, i) => ({
      projectId, orderIndex: i, narration: s.narration, visualPrompt: s.visualPrompt, durationSec: s.durationSec,
    })));
    await getDb().update(videoProjects)
      .set({ status: "scenes_ready", errorMessage: r.warning || null, updatedAt: new Date() })
      .where(eq(videoProjects.id, projectId));
  } catch (e: any) {
    console.error("tách cảnh:", e?.message || e);
    await getDb().update(videoProjects)
      .set({ status: "error", errorMessage: String(e?.message || e).slice(0, 300), updatedAt: new Date() })
      .where(eq(videoProjects.id, projectId)).catch(() => {});
  }
}

/** Bước 3 chạy nền: sinh hình từng cảnh. TỐN TIỀN. */
async function runGenerateInBackground(projectId: string, aspectRatio: string) {
  const db = getDb();
  try {
    await db.update(videoProjects).set({ status: "generating", errorMessage: null, updatedAt: new Date() }).where(eq(videoProjects.id, projectId));
    const scenes = await db.select().from(videoScenes).where(eq(videoScenes.projectId, projectId)).orderBy(asc(videoScenes.orderIndex));

    let done = 0;
    for (const sc of scenes) {
      if (sc.clipKey) { done += 1; continue; } // đã sinh rồi thì bỏ qua — không tiêu tiền hai lần
      if (!sc.visualPrompt) continue;

      await db.update(videoScenes).set({ status: "generating", errorMessage: null, updatedAt: new Date() }).where(eq(videoScenes.id, sc.id));
      try {
        const { buffer } = await generateVideo({
          prompt: sc.visualPrompt,
          aspectRatio: aspectRatio === "16:9" ? "16:9" : "9:16",
          durationSeconds: sc.durationSec,
        });
        const key = newKey("videos", "mp4");
        await storage.put(key, buffer);
        await db.update(videoScenes).set({ status: "ready", clipKey: key, updatedAt: new Date() }).where(eq(videoScenes.id, sc.id));
        done += 1;
      } catch (e: any) {
        // Một cảnh hỏng không nên làm chết cả dự án — ghi lỗi rồi đi tiếp,
        // người dùng sinh lại riêng cảnh đó sau.
        await db.update(videoScenes)
          .set({ status: "error", errorMessage: String(e?.message || e).slice(0, 300), updatedAt: new Date() })
          .where(eq(videoScenes.id, sc.id));
      }
    }

    await db.update(videoProjects).set({
      status: "scenes_ready", generatedCount: done, updatedAt: new Date(),
      errorMessage: done === 0 ? "Không sinh được cảnh nào." : null,
    }).where(eq(videoProjects.id, projectId));
  } catch (e: any) {
    console.error("sinh hình:", e?.message || e);
    await db.update(videoProjects)
      .set({ status: "error", errorMessage: String(e?.message || e).slice(0, 300), updatedAt: new Date() })
      .where(eq(videoProjects.id, projectId)).catch(() => {});
  }
}

/** Bước 4 chạy nền: ghép các cảnh thành một video. */
async function runRenderInBackground(projectId: string) {
  const db = getDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "outlier-render-"));
  try {
    await db.update(videoProjects).set({ status: "rendering", errorMessage: null, updatedAt: new Date() }).where(eq(videoProjects.id, projectId));
    const scenes = await db.select().from(videoScenes).where(eq(videoScenes.projectId, projectId)).orderBy(asc(videoScenes.orderIndex));
    const ready = scenes.filter((s) => s.clipKey);
    if (ready.length === 0) throw new Error("Chưa có cảnh nào được dựng hình.");

    const paths: string[] = [];
    for (const [i, sc] of ready.entries()) {
      const buf = await storage.get(sc.clipKey!);
      if (!buf) continue;
      const p = path.join(dir, `c${String(i).padStart(3, "0")}.mp4`);
      fs.writeFileSync(p, buf);
      paths.push(p);
    }
    if (paths.length === 0) throw new Error("Không đọc được tệp cảnh nào.");

    const outPath = path.join(dir, "final.mp4");
    await concatClips(paths, outPath);

    const key = newKey("videos", "mp4");
    await storage.put(key, fs.readFileSync(outPath));
    await db.update(videoProjects)
      .set({ status: "ready", finalVideoKey: key, updatedAt: new Date() })
      .where(eq(videoProjects.id, projectId));
  } catch (e: any) {
    console.error("ghép video:", e?.message || e);
    await db.update(videoProjects)
      .set({ status: "error", errorMessage: String(e?.message || e).slice(0, 300), updatedAt: new Date() })
      .where(eq(videoProjects.id, projectId)).catch(() => {});
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function registerVideoRoutes(app: Express) {
  app.get("/api/videos", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const u = getAuthUser(req)!;
    try {
      const rows = await getDb().select().from(videoProjects).where(eq(videoProjects.owner, u))
        .orderBy(desc(videoProjects.createdAt)).limit(50);
      res.json(rows);
    } catch (e: any) {
      console.error("videos list:", e?.message || e);
      res.status(500).json({ error: "Không tải được danh sách." });
    }
  });

  app.get("/api/videos/:id", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "Mã không hợp lệ." });
    try {
      const [row] = await getDb().select().from(videoProjects).where(eq(videoProjects.id, id));
      if (!row) return res.status(404).json({ error: "Không tìm thấy dự án video." });
      if (!(await canTouch(req, row))) return res.status(403).json({ error: "Không có quyền xem." });
      const scenes = await getDb().select().from(videoScenes).where(eq(videoScenes.projectId, id)).orderBy(asc(videoScenes.orderIndex));
      const pending = scenes.filter((s) => !s.clipKey).length;
      res.json({
        ...row, scenes,
        pendingScenes: pending,
        estimatedCostUsd: Number(estimateSceneCostUsd(pending).toFixed(2)),
        usdPerScene: USD_PER_SCENE,
      });
    } catch (e: any) {
      console.error("video get:", e?.message || e);
      res.status(500).json({ error: "Không tải được dự án." });
    }
  });

  // ===== Bước 1: tạo dự án + tách cảnh (rẻ) =====
  app.post("/api/videos", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const u = getAuthUser(req)!;
    const remakeId = UUID_RE.test(req.body?.remakeId || "") ? req.body.remakeId : null;
    let script = String(req.body?.script || "").trim();
    let title = String(req.body?.title || "").trim() || null;

    try {
      if (!script && remakeId) {
        const [r] = await getDb().select().from(remakes).where(eq(remakes.id, remakeId));
        if (!r) return res.status(404).json({ error: "Không tìm thấy bản viết." });
        if (!r.draft) return res.status(400).json({ error: "Bản viết này chưa có nội dung." });
        script = r.draft;
        title = title || r.sourceTitle || null;
      }
      if (!script) return res.status(400).json({ error: "Cần nội dung kịch bản hoặc mã bản viết." });

      const [row] = await getDb().insert(videoProjects).values({
        owner: u, remakeId, title, scriptText: script,
        aspectRatio: req.body?.aspectRatio === "16:9" ? "16:9" : "9:16",
        status: "splitting",
      }).returning();

      res.status(201).json({
        ...row, polling: true,
        message: "Đang tách kịch bản thành cảnh. Bước này chưa tốn phí.",
        note: `Sau khi tách xong, bạn xem và sửa từng cảnh rồi mới bấm dựng hình. Tối đa ${MAX_SCENES} cảnh.`,
      });
      void runSplitInBackground(row.id, script);
    } catch (e: any) {
      console.error("video create:", e?.message || e);
      res.status(500).json({ error: "Không tạo được dự án video." });
    }
  });

  // ===== Sửa một cảnh trước khi tiêu tiền =====
  app.patch("/api/videos/:id/scenes/:sid", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id, sid } = req.params;
    if (!UUID_RE.test(id) || !UUID_RE.test(sid)) return res.status(400).json({ error: "Mã không hợp lệ." });
    try {
      const [proj] = await getDb().select().from(videoProjects).where(eq(videoProjects.id, id));
      if (!proj) return res.status(404).json({ error: "Không tìm thấy dự án." });
      if (!(await canTouch(req, proj))) return res.status(403).json({ error: "Không có quyền sửa." });

      const patch: Record<string, any> = { updatedAt: new Date() };
      if (typeof req.body?.narration === "string") patch.narration = req.body.narration.trim() || null;
      if (typeof req.body?.visualPrompt === "string") patch.visualPrompt = req.body.visualPrompt.trim() || null;
      if (req.body?.durationSec !== undefined) {
        const d = Number(req.body.durationSec);
        if (Number.isFinite(d) && d >= 3 && d <= 10) patch.durationSec = Math.round(d);
      }
      // Sửa mô tả hình thì clip cũ không còn đúng nữa — bỏ để sinh lại.
      if (patch.visualPrompt !== undefined) { patch.clipKey = null; patch.status = "pending"; }

      const [row] = await getDb().update(videoScenes).set(patch).where(eq(videoScenes.id, sid)).returning();
      if (!row) return res.status(404).json({ error: "Không tìm thấy cảnh." });
      res.json(row);
    } catch (e: any) {
      console.error("scene patch:", e?.message || e);
      res.status(500).json({ error: "Không lưu được thay đổi." });
    }
  });

  // ===== Ước tính chi phí TRƯỚC khi dựng hình =====
  app.get("/api/videos/:id/quote", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "Mã không hợp lệ." });
    try {
      const scenes = await getDb().select().from(videoScenes).where(eq(videoScenes.projectId, id));
      const pending = scenes.filter((s) => !s.clipKey).length;
      res.json({
        pendingScenes: pending,
        estimatedCostUsd: Number(estimateSceneCostUsd(pending).toFixed(2)),
        usdPerScene: USD_PER_SCENE,
        note: "Đây là ước tính. Cảnh đã dựng rồi sẽ không dựng lại nên không tính tiền lần hai.",
      });
    } catch (e: any) {
      console.error("video quote:", e?.message || e);
      res.status(500).json({ error: "Không ước tính được." });
    }
  });

  // ===== Bước 3: dựng hình (TỐN TIỀN) =====
  app.post("/api/videos/:id/generate", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "Mã không hợp lệ." });
    try {
      const [proj] = await getDb().select().from(videoProjects).where(eq(videoProjects.id, id));
      if (!proj) return res.status(404).json({ error: "Không tìm thấy dự án." });
      if (!(await canTouch(req, proj))) return res.status(403).json({ error: "Không có quyền." });
      if (proj.status === "generating") return res.status(409).json({ error: "Đang dựng hình, chờ một chút." });

      const scenes = await getDb().select().from(videoScenes).where(eq(videoScenes.projectId, id));
      const pending = scenes.filter((s) => !s.clipKey).length;
      if (pending === 0) return res.json({ ...proj, message: "Mọi cảnh đã có hình, không cần dựng lại." });

      res.json({
        ...proj, status: "generating", polling: true,
        willGenerate: pending,
        estimatedCostUsd: Number(estimateSceneCostUsd(pending).toFixed(2)),
        message: `Đang dựng hình cho ${pending} cảnh. Mỗi cảnh mất 1-3 phút.`,
      });
      void runGenerateInBackground(id, proj.aspectRatio);
    } catch (e: any) {
      console.error("video generate:", e?.message || e);
      res.status(500).json({ error: "Không dựng được hình." });
    }
  });

  // ===== Bước 4: ghép (miễn phí) =====
  app.post("/api/videos/:id/render", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "Mã không hợp lệ." });
    try {
      const [proj] = await getDb().select().from(videoProjects).where(eq(videoProjects.id, id));
      if (!proj) return res.status(404).json({ error: "Không tìm thấy dự án." });
      if (!(await canTouch(req, proj))) return res.status(403).json({ error: "Không có quyền." });
      if (!(await hasFfmpeg())) return res.status(503).json({ error: "Máy chủ chưa có ffmpeg nên chưa ghép được video." });

      res.json({ ...proj, status: "rendering", polling: true, message: "Đang ghép các cảnh thành một video." });
      void runRenderInBackground(id);
    } catch (e: any) {
      console.error("video render:", e?.message || e);
      res.status(500).json({ error: "Không ghép được video." });
    }
  });

  app.delete("/api/videos/:id", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "Mã không hợp lệ." });
    try {
      const [proj] = await getDb().select().from(videoProjects).where(eq(videoProjects.id, id));
      if (!proj) return res.status(404).json({ error: "Không tìm thấy dự án." });
      if (!(await canTouch(req, proj))) return res.status(403).json({ error: "Không có quyền xoá." });
      await getDb().delete(videoScenes).where(eq(videoScenes.projectId, id));
      await getDb().delete(videoProjects).where(eq(videoProjects.id, id));
      res.json({ success: true });
    } catch (e: any) {
      console.error("video delete:", e?.message || e);
      res.status(500).json({ error: "Không xoá được." });
    }
  });
}

/** Dùng chung cho MCP — không nhân bản logic. */
export const runSplitForMcp = runSplitInBackground;
