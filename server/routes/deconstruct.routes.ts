// Bóc cấu trúc bài — "vì sao bài này giữ được người xem" (docs/PRD.md §4 J3).
//
// Phân tích mất 1-3 phút (tải video + gọi model) nên CHẠY NỀN: endpoint trả về
// ngay, client theo dõi bằng GET /api/deconstructions/:id (xem docs/ARCH.md §4b).
import type { Express } from "express";
import { desc, eq } from "drizzle-orm";
import { getDb, isDbConfigured } from "../db/client";
import { deconstructions, radarItems } from "../db/schema";
import { requireAuth, getAuthUser } from "../auth-mw";
import { deconstruct, NEEDS_PAID_FETCH, platformOfUrl } from "../services/deconstruct";
import { fetchPostViaApify } from "../services/post-fetch";
import { estimateCostUsd, isApifyConfigured } from "../services/apify";
import { deconstructFromTranscript } from "../services/deconstruct";
import { assertPublicUrl } from "../services/brand-ingest";
import { isActiveAdmin } from "./studio.routes";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function dbDown(res: any): boolean {
  if (!isDbConfigured()) {
    res.status(503).json({ error: "Tính năng dữ liệu chưa khả dụng (thiếu DATABASE_URL)." });
    return true;
  }
  return false;
}

/** Phân tích chạy nền; lỗi ghi thẳng vào bản ghi vì request đã trả về rồi. */
export async function runDeconstructInBackground(id: string, url: string, allowPaid = false) {
  try {
    await getDb().update(deconstructions).set({ status: "analyzing", updatedAt: new Date() }).where(eq(deconstructions.id, id));

    const platform = platformOfUrl(url);

    // TikTok/Facebook/Instagram không tải trực tiếp được nữa — phải qua dịch vụ
    // có phí. Chỉ chạy khi người dùng đã đồng ý trả phí.
    if (platform && NEEDS_PAID_FETCH.has(platform)) {
      if (!allowPaid) {
        await getDb().update(deconstructions).set({
          status: "error",
          needsPaid: true,
          estimatedCostUsd: estimateCostUsd(1).toFixed(3),
          contentKind: platform === "facebook" ? "post" : "video",
          errorMessage:
            `Nội dung ${platform === "facebook" ? "Facebook" : platform === "tiktok" ? "TikTok" : "Instagram"} ` +
            `không lấy được bằng công cụ miễn phí. Cần dùng dịch vụ có phí — khoảng ` +
            `${estimateCostUsd(1).toFixed(3)} USD cho một bài. Bấm "Phân tích có phí" để tiếp tục.`,
          updatedAt: new Date(),
        }).where(eq(deconstructions.id, id));
        return;
      }
      if (!isApifyConfigured()) {
        await getDb().update(deconstructions)
          .set({ status: "error", errorMessage: "Chưa cấu hình dịch vụ lấy bài có phí.", updatedAt: new Date() })
          .where(eq(deconstructions.id, id));
        return;
      }

      const out = await fetchPostViaApify(url);
      if (!out.post) {
        await getDb().update(deconstructions)
          .set({ status: "error", errorMessage: out.warning || "Không lấy được nội dung bài.", updatedAt: new Date() })
          .where(eq(deconstructions.id, id));
        return;
      }
      const post = out.post;

      // Bài chữ thì phân tích phần chữ; video thì vẫn đi đường phân tích video.
      let structure: any = null;
      let dropped: string[] = [];
      let warn = out.warning;
      if (post.text && post.text.trim().length > 40) {
        const viaText = await deconstructFromTranscript(post.text, {
          title: post.title, durationSec: post.durationSec,
        });
        structure = viaText.structure;
        dropped = viaText.dropped;
        warn = [warn, viaText.warning].filter(Boolean).join(" · ") || undefined;
      }
      const hasContent = !!(structure && (structure.hook3s || structure.formula || (structure.retentionBeats || []).length));

      await getDb().update(deconstructions).set({
        status: hasContent || post.text ? "ready" : "error",
        needsPaid: false,
        title: post.text ? post.text.slice(0, 120) : null,
        platform: platform,
        contentKind: post.kind,
        thumbnailUrl: post.thumbnailUrl ?? null,
        bodyText: post.text ?? null,
        views: post.views ?? null, likes: post.likes ?? null,
        comments: post.comments ?? null, shares: post.shares ?? null,
        followerCount: post.followerCount ?? null,
        channelName: post.channelName ?? null,
        durationSec: post.durationSec ?? null,
        structure: hasContent ? structure : null,
        analysisMode: "transcript",
        analyzedBy: "apify+gemini",
        errorMessage: [warn, ...dropped].filter(Boolean).join(" · ").slice(0, 500) || null,
        updatedAt: new Date(),
      } as any).where(eq(deconstructions.id, id));
      return;
    }

    const r = await deconstruct(url);
    const hasContent = !!(r.structure.hook3s || r.structure.formula || (r.structure.retentionBeats || []).length);

    await getDb().update(deconstructions).set({
      status: hasContent ? "ready" : "error",
      title: r.info.title ?? null,
      platform: r.info.platform ?? null,
      durationSec: r.info.durationSec ?? null,
      transcript: r.transcript ?? null,
      structure: hasContent ? (r.structure as any) : null,
      analysisMode: r.analysisMode,
      analyzedBy: "gemini",
      // `dropped` = các mốc bị loại vì không đối chiếu được với độ dài video.
      // Giữ lại để người dùng biết vì sao kết quả thiếu, thay vì im lặng.
      errorMessage: [r.warning, ...(r.dropped || [])].filter(Boolean).join(" · ").slice(0, 500) || null,
      updatedAt: new Date(),
    }).where(eq(deconstructions.id, id));
  } catch (e: any) {
    console.error("deconstruct (nền):", e?.message || e);
    await getDb().update(deconstructions)
      .set({ status: "error", errorMessage: String(e?.message || e).slice(0, 400), updatedAt: new Date() })
      .where(eq(deconstructions.id, id))
      .catch(() => {});
  }
}

export function registerDeconstructRoutes(app: Express) {
  app.get("/api/deconstructions", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const username = getAuthUser(req)!;
    try {
      const rows = await getDb().select().from(deconstructions)
        .where(eq(deconstructions.owner, username))
        .orderBy(desc(deconstructions.createdAt)).limit(50);
      res.json(rows);
    } catch (e: any) {
      console.error("deconstruct list:", e?.message || e);
      res.status(500).json({ error: "Không tải được danh sách." });
    }
  });

  app.get("/api/deconstructions/:id", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "Mã không hợp lệ." });
    try {
      const [row] = await getDb().select().from(deconstructions).where(eq(deconstructions.id, id));
      if (!row) return res.status(404).json({ error: "Không tìm thấy bản phân tích." });
      const username = getAuthUser(req)!;
      if (row.owner !== username && !(await isActiveAdmin(username))) {
        return res.status(403).json({ error: "Không có quyền xem bản phân tích này." });
      }
      res.json(row);
    } catch (e: any) {
      console.error("deconstruct get:", e?.message || e);
      res.status(500).json({ error: "Không tải được bản phân tích." });
    }
  });

  // ===== Bắt đầu phân tích =====
  // ===== Bình luận: lấy về rồi rút ra người xem quan tâm gì =====
  // Tách khỏi việc bóc cấu trúc vì tốn tiền riêng (mỗi bình luận là một kết quả
  // Apify) — người dùng phải chủ động bấm, và thấy trước con số ước tính.
  app.post("/api/deconstructions/:id/comments", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "Mã không hợp lệ." });
    const limit = Math.min(300, Math.max(10, Number(req.body?.limit) || 100));

    try {
      const [row] = await getDb().select().from(deconstructions).where(eq(deconstructions.id, id));
      if (!row) return res.status(404).json({ error: "Không tìm thấy bản phân tích." });

      const platform = (row.platform || "").toLowerCase();
      let comments: { text: string; likes?: number; author?: string }[] = [];
      let warning: string | undefined;
      let costUsd = 0;

      if (platform === "youtube") {
        // YouTube đọc miễn phí bằng API key — không đụng tới Apify.
        const { fetchYouTubeComments } = await import("../services/youtube-comments");
        const out = await fetchYouTubeComments(row.sourceUrl, limit);
        comments = out.comments;
        warning = out.warning;
      } else {
        const { fetchComments } = await import("../services/comment-fetch");
        const out = await fetchComments(platform, row.sourceUrl, limit);
        comments = out.comments;
        warning = out.warning;
        costUsd = out.costUsd;
      }

      if (comments.length === 0) {
        return res.status(400).json({ error: warning || "Không lấy được bình luận nào." });
      }

      const { analyzeComments } = await import("../services/audience-insight");
      const { insight } = await analyzeComments(comments);

      await getDb()
        .update(deconstructions)
        .set({ commentsJson: comments, audienceInsight: insight, commentsFetchedAt: new Date(), updatedAt: new Date() })
        .where(eq(deconstructions.id, id));

      res.json({ fetched: comments.length, costUsd, insight, warning });
    } catch (e: any) {
      console.warn("fetch comments:", e?.message || e);
      res.status(400).json({ error: e?.message || "Không phân tích được bình luận." });
    }
  });

  app.post("/api/deconstructions", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const username = getAuthUser(req)!;
    const rawUrl = String(req.body?.url || "").trim();
    const radarItemId = UUID_RE.test(req.body?.radarItemId || "") ? req.body.radarItemId : null;

    let url = rawUrl;
    try {
      // Cho phép chỉ đưa mã bài trong Radar, tự lấy link ra.
      if (!url && radarItemId) {
        const [item] = await getDb().select().from(radarItems).where(eq(radarItems.id, radarItemId));
        if (!item) return res.status(404).json({ error: "Không tìm thấy bài trong kết quả quét." });
        url = item.url;
      }
      if (!url) return res.status(400).json({ error: "Dán link bài muốn phân tích." });
      assertPublicUrl(url); // chặn link trỏ vào mạng nội bộ
    } catch (e: any) {
      return res.status(400).json({ error: e?.message || "Link không hợp lệ." });
    }

    try {
      const [row] = await getDb().insert(deconstructions)
        .values({ owner: username, sourceUrl: url, radarItemId, status: "downloading" })
        .returning();

      res.status(201).json({
        ...row, polling: true,
        message: "Đang phân tích bài này. Việc này mất khoảng 1-3 phút.",
      });

      void runDeconstructInBackground(row.id, url, req.body?.allowPaid === true);
    } catch (e: any) {
      console.error("deconstruct create:", e?.message || e);
      res.status(500).json({ error: "Không bắt đầu phân tích được." });
    }
  });

  app.delete("/api/deconstructions/:id", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "Mã không hợp lệ." });
    try {
      const [row] = await getDb().select().from(deconstructions).where(eq(deconstructions.id, id));
      if (!row) return res.status(404).json({ error: "Không tìm thấy bản phân tích." });
      const username = getAuthUser(req)!;
      if (row.owner !== username && !(await isActiveAdmin(username))) {
        return res.status(403).json({ error: "Không có quyền xoá." });
      }
      await getDb().delete(deconstructions).where(eq(deconstructions.id, id));
      res.json({ success: true });
    } catch (e: any) {
      console.error("deconstruct delete:", e?.message || e);
      res.status(500).json({ error: "Không xoá được." });
    }
  });
}

/** Dùng chung cho MCP (server/routes/mcp-signals.routes.ts) — không nhân bản logic. */
export const runDeconstructForMcp = runDeconstructInBackground;
