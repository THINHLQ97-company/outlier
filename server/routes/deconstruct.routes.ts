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
/**
 * Bóc cấu trúc từ dữ liệu ĐÃ QUÉT, không gọi lại dịch vụ tính tiền.
 *
 * Lúc quét kênh đã trả tiền để lấy caption, ảnh và số liệu của bài này rồi.
 * Quét lại là trả tiền hai lần cho cùng một thứ. Phần còn thiếu — hiểu nội
 * dung trong ảnh — làm bằng Gemini, miễn phí.
 *
 * Bình luận vẫn là việc riêng, người dùng tự bấm và tự quyết có trả tiền không.
 */
export async function runDeconstructFromRadarItem(
  id: string,
  item: typeof radarItems.$inferSelect,
) {
  try {
    const { readImage, imageReadingToText } = await import("../services/image-read");
    const imageReading = item.coverUrl ? await readImage(item.coverUrl) : null;

    const combined = [item.title || "", imageReading ? imageReadingToText(imageReading) : ""]
      .filter((x) => x.trim())
      .join("\n\n");

    let structure: any = null;
    let dropped: string[] = [];
    let warning: string | undefined;
    if (combined.trim().length > 40) {
      const out = await deconstructFromTranscript(combined, { title: item.title, durationSec: item.durationSec });
      structure = out.structure;
      dropped = out.dropped;
      warning = out.warning;
    } else {
      warning = "Bài này quá ít nội dung để rút ra cách triển khai.";
    }

    await getDb().update(deconstructions).set({
      status: "ready",
      needsPaid: false,
      imageReading,
      bodyText: item.title ?? null,
      structure,
      analysisMode: "transcript",
      analyzedBy: "gemini-vision",
      errorMessage: [warning, ...dropped].filter(Boolean).join(" · ").slice(0, 500) || null,
      updatedAt: new Date(),
    } as any).where(eq(deconstructions.id, id));
  } catch (e: any) {
    console.error("deconstruct from radar item:", e?.message || e);
    await getDb().update(deconstructions)
      .set({ status: "error", errorMessage: String(e?.message || e).slice(0, 300), updatedAt: new Date() })
      .where(eq(deconstructions.id, id));
  }
}

export async function runDeconstructInBackground(id: string, url: string, _allowPaid = true) {
  try {
    await getDb().update(deconstructions).set({ status: "analyzing", updatedAt: new Date() }).where(eq(deconstructions.id, id));

    const platform = platformOfUrl(url);

    // TikTok/Facebook/Instagram không tải trực tiếp được — phải qua dịch vụ có
    // phí. Chạy thẳng, KHÔNG hỏi trước.
    //
    // Bỏ bước hỏi vì nó vừa phiền vừa chẳng chặn được gì: ai cũng bấm đồng ý,
    // mà mỗi lần bấm lại đẻ thêm một bản phân tích nữa trong danh sách. Thứ
    // chặn chi phí thật là TRẦN NGÀY — hết hạn mức thì dừng hẳn, nói rõ lý do.
    if (platform && NEEDS_PAID_FETCH.has(platform)) {
      const { budgetLeftToday } = await import("../services/apify");
      const budget = await budgetLeftToday();
      if (!budget.ok) {
        await getDb().update(deconstructions).set({
          status: "error",
          needsPaid: false,
          contentKind: platform === "facebook" ? "post" : "video",
          errorMessage: budget.reason || "Hết hạn mức quét có phí hôm nay.",
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

      // Đọc ảnh TRƯỚC khi bóc cấu trúc: với nhiều bài, chữ nằm trong ảnh mới là
      // nội dung chính còn caption chỉ là một dòng dẫn. Bóc mà bỏ qua ảnh là bỏ
      // sót đúng phần hay nhất. Miễn phí (Gemini), nên luôn làm khi có ảnh.
      let imageReading = null;
      if (post.thumbnailUrl) {
        const { readImage } = await import("../services/image-read");
        imageReading = await readImage(post.thumbnailUrl);
      }

      // Gộp caption với chữ trong ảnh rồi mới bóc — nhờ vậy bài caption một dòng
      // mà ảnh đầy chữ vẫn ra được cách triển khai.
      const { imageReadingToText } = await import("../services/image-read");
      const combined = [post.text || "", imageReading ? imageReadingToText(imageReading) : ""]
        .filter((x) => x.trim())
        .join("\n\n");

      if (combined.trim().length > 40) {
        const viaText = await deconstructFromTranscript(combined, {
          title: post.title, durationSec: post.durationSec,
        });
        structure = viaText.structure;
        dropped = viaText.dropped;
        warn = [warn, viaText.warning].filter(Boolean).join(" · ") || undefined;
      }
      const hasContent = !!(structure && (structure.hook3s || structure.formula || (structure.retentionBeats || []).length));

      await getDb().update(deconstructions).set({
        status: hasContent || post.text || imageReading ? "ready" : "error",
        needsPaid: false,
        title:
          post.text?.trim()
            ? post.text.slice(0, 120)
            : imageReading?.textInImage
            ? imageReading.textInImage.slice(0, 120)
            : null,
        platform: platform,
        contentKind: post.kind,
        thumbnailUrl: post.thumbnailUrl ?? null,
        imageReading,
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
  // ===== Bóc cấu trúc từ ẢNH TẢI LÊN =====
  // Nhiều bài hay chỉ còn lại ảnh chụp màn hình, hoặc link thì tốn tiền quét.
  // Đường này hoàn toàn MIỄN PHÍ (chỉ dùng Gemini) và không đụng Apify.
  app.post("/api/deconstructions/from-image", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const username = getAuthUser(req)!;
    const dataUrl = typeof req.body?.imageBase64 === "string" ? req.body.imageBase64 : "";
    const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
    const caption = typeof req.body?.caption === "string" ? req.body.caption.trim() : "";
    if (!dataUrl) return res.status(400).json({ error: "Chưa có ảnh." });

    try {
      const { parseDataUrl, persistDataUrl } = await import("../storage");
      const parsed = parseDataUrl(dataUrl);
      if (!parsed) return res.status(400).json({ error: "Ảnh không đọc được — cần tệp ảnh thật." });
      if (parsed.buffer.length > 8 * 1024 * 1024) {
        return res.status(400).json({ error: "Ảnh lớn hơn 8MB — thu nhỏ rồi thử lại." });
      }

      const { readImageData, imageReadingToText } = await import("../services/image-read");
      const reading = await readImageData({
        mimeType: `image/${parsed.ext === "jpg" ? "jpeg" : parsed.ext}`,
        data: parsed.buffer.toString("base64"),
      });
      if (!reading) {
        return res.status(400).json({ error: "Không đọc được nội dung trong ảnh. Thử ảnh rõ hơn." });
      }

      // Giữ lại ảnh để người dùng đối chiếu với kết luận.
      const storedUrl = await persistDataUrl("deconstruct", dataUrl);

      // Bóc cấu trúc từ nội dung đọc được, gộp cả caption nếu người dùng có dán.
      const combined = [caption, imageReadingToText(reading), note ? `Ghi chú: ${note}` : ""]
        .filter((x) => x.trim())
        .join("\n\n");

      let structure: any = null;
      let dropped: string[] = [];
      let warning: string | undefined;
      if (combined.trim().length > 40) {
        const viaText = await deconstructFromTranscript(combined, { title: null, durationSec: null });
        structure = viaText.structure;
        dropped = viaText.dropped;
        warning = viaText.warning;
      } else {
        warning = "Ảnh có quá ít nội dung để rút ra cách triển khai.";
      }

      const [row] = await getDb().insert(deconstructions).values({
        owner: username,
        // Ảnh tải lên không có bài gốc trên mạng; trỏ về chính ảnh đã lưu để
        // người dùng mở lại được, thay vì để trống rồi hỏng chỗ khác.
        sourceUrl: storedUrl || "upload://image",
        platform: "upload",
        contentKind: "image",
        status: "ready",
        title: caption ? caption.slice(0, 120) : reading.textInImage.slice(0, 120) || "Ảnh tải lên",
        thumbnailUrl: storedUrl,
        imageReading: reading,
        bodyText: caption || null,
        structure,
        analysisMode: "transcript",
        analyzedBy: "gemini-vision",
        errorMessage: [warning, ...dropped].filter(Boolean).join(" · ").slice(0, 500) || null,
      } as any).returning();

      res.status(201).json(row);
    } catch (e: any) {
      console.error("deconstruct from image:", e?.message || e);
      res.status(500).json({ error: e?.message || "Không phân tích được ảnh." });
    }
  });

  // Báo giá TRƯỚC khi chạy, để người dùng quyết định có bấm hay không.
  // Con số này là trần: tiền thật tính theo số bình luận nhận về, có thể ít hơn.
  app.get("/api/deconstructions/:id/comments/estimate", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "Mã không hợp lệ." });
    const limit = Math.min(300, Math.max(10, Number(req.query.limit) || 100));
    try {
      const [row] = await getDb().select().from(deconstructions).where(eq(deconstructions.id, id));
      if (!row) return res.status(404).json({ error: "Không tìm thấy bản phân tích." });

      const platform = (row.platform || "").toLowerCase();
      if (platform === "youtube") {
        return res.json({
          platform,
          free: true,
          maxCostUsd: 0,
          note: "YouTube đọc bình luận miễn phí bằng Data API v3 — không tốn đồng nào.",
        });
      }

      const { estimateCommentCostUsd, supportsComments } = await import("../services/comment-fetch");
      if (!supportsComments(platform)) {
        return res.json({ platform, free: false, maxCostUsd: 0, unsupported: true, note: `Chưa hỗ trợ lấy bình luận từ ${platform}.` });
      }

      const { getCostSummary } = await import("../services/cost-tracker");
      const summary = await getCostSummary();
      const maxCostUsd = estimateCommentCostUsd(limit);

      res.json({
        platform,
        free: false,
        limit,
        maxCostUsd,
        // Cho thấy khoản này nằm ở đâu trong ngân sách, không chỉ đưa con số trần trụi.
        budget: summary.dailyBudget,
        spentToday: summary.today.costUsd,
        note: `Tối đa ${maxCostUsd.toFixed(3)} đô cho ${limit} bình luận. Tiền thật tính theo số nhận về, có thể ít hơn.`,
        overBudget: summary.dailyBudget.remaining < limit,
      });
    } catch (e: any) {
      console.error("estimate comments:", e?.message || e);
      res.status(500).json({ error: "Không ước tính được." });
    }
  });

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
    // Bài đến từ kết quả quét thì mọi thứ cần thiết đã có sẵn và đã trả tiền
    // rồi: caption, ảnh, số liệu. Quét lại là trả tiền hai lần cho cùng một bài.
    let fromRadar: typeof radarItems.$inferSelect | null = null;
    try {
      if (!url && radarItemId) {
        const [item] = await getDb().select().from(radarItems).where(eq(radarItems.id, radarItemId));
        if (!item) return res.status(404).json({ error: "Không tìm thấy bài trong kết quả quét." });
        url = item.url;
        fromRadar = item;
      } else if (radarItemId) {
        const [item] = await getDb().select().from(radarItems).where(eq(radarItems.id, radarItemId));
        fromRadar = item || null;
      }
      if (!url) return res.status(400).json({ error: "Dán link bài muốn phân tích." });
      assertPublicUrl(url); // chặn link trỏ vào mạng nội bộ
    } catch (e: any) {
      return res.status(400).json({ error: e?.message || "Link không hợp lệ." });
    }

    try {
      const [row] = await getDb().insert(deconstructions)
        .values({
          owner: username,
          sourceUrl: url,
          radarItemId,
          status: "downloading",
          // Chép sẵn những gì đã có — nếu đi đường miễn phí thì đây là dữ liệu chính.
          ...(fromRadar
            ? {
                platform: fromRadar.platform,
                title: fromRadar.title,
                thumbnailUrl: fromRadar.coverUrl,
                views: fromRadar.views,
                likes: fromRadar.likes,
                comments: fromRadar.comments,
                shares: fromRadar.shares,
                followerCount: fromRadar.followerCount,
                channelName: fromRadar.channelName,
                durationSec: fromRadar.durationSec,
                contentKind: fromRadar.contentKind,
              }
            : {}),
        } as any)
        .returning();

      // Bài viết (không phải video) đã có caption và ảnh thì bóc được ngay mà
      // không tốn đồng nào: đọc ảnh bằng Gemini rồi rút cách triển khai. Chỉ
      // lấy BÌNH LUẬN mới phải trả tiền, và đó là việc riêng người dùng tự bấm.
      // Dựa vào NỀN TẢNG chứ không vào nhãn contentKind: bài Facebook quét
      // trước hôm nay bị đánh nhầm là "video", tin vào nhãn đó là lại trả tiền
      // oan. Chỉ YouTube/TikTok/Douyin mới thật sự cần tải video về.
      const VIDEO_PLATFORMS = ["youtube", "tiktok", "douyin"];
      const canDoFree =
        !!fromRadar &&
        !VIDEO_PLATFORMS.includes(fromRadar.platform) &&
        !!(fromRadar.title?.trim() || fromRadar.coverUrl);

      res.status(201).json({
        ...row,
        polling: true,
        message: canDoFree
          ? "Đang phân tích bằng dữ liệu đã quét — không tốn thêm phí."
          : "Đang phân tích bài này. Việc này mất khoảng 1-3 phút.",
        free: canDoFree,
      });

      if (canDoFree) {
        void runDeconstructFromRadarItem(row.id, fromRadar!);
      } else {
        void runDeconstructInBackground(row.id, url);
      }
    } catch (e: any) {
      console.error("deconstruct create:", e?.message || e);
      res.status(500).json({ error: "Không bắt đầu phân tích được." });
    }
  });

  // POST /api/deconstructions/from-trend — biến một xu hướng thành CÁCH TRIỂN
  // KHAI, để nó đi đúng luồng như mọi nguồn khác (bóc → viết lại + điều hướng).
  //
  // Trước đây trend nhảy thẳng ra bài: không xem lại được công thức đã dùng,
  // không sửa được nó, và không lái được góc bài.
  app.post("/api/deconstructions/from-trend", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const title = String(req.body?.title || "").trim();
    const summary = String(req.body?.summary || "").trim();
    const sourceUrl = String(req.body?.sourceUrl || "").trim();
    if (!title && !summary) return res.status(400).json({ error: "Cần tiêu đề hoặc nội dung xu hướng." });

    try {
      const db = getDb();
      const [row] = await db
        .insert(deconstructions)
        .values({
          owner: getAuthUser(req)!,
          sourceUrl: sourceUrl || "trend://" + encodeURIComponent(title.slice(0, 60)),
          platform: "trend",
          contentKind: "post",
          status: "analyzing",
          title: title.slice(0, 200) || "Xu hướng",
          bodyText: summary || null,
        } as any)
        .returning({ id: deconstructions.id });

      res.status(201).json({ id: row.id, status: "analyzing", polling: true });

      // Chạy nền: lên góc mất vài giây, giữ request mở là vô ích.
      void (async () => {
        const { structureFromTrend } = await import("../services/trend-structure");
        const out = await structureFromTrend(title, summary);
        await db
          .update(deconstructions)
          .set({
            status: out.structure ? "ready" : "error",
            structure: out.structure,
            analysisMode: "transcript",
            analyzedBy: "gemini",
            errorMessage: out.warning || null,
            updatedAt: new Date(),
          } as any)
          .where(eq(deconstructions.id, row.id));
      })().catch((e: any) => console.error("from-trend:", e?.message || e));
    } catch (e: any) {
      console.error("deconstruct from trend:", e?.message || e);
      res.status(500).json({ error: "Không lên góc được từ xu hướng này." });
    }
  });

  // POST /api/deconstructions/:id/retry-paid — chạy lại CHÍNH bản này ở chế độ
  // có phí.
  //
  // Trước đây nút "Phân tích có phí" gọi API tạo mới, nên mỗi lần bấm lại đẻ ra
  // một bản nữa: danh sách có hai dòng cùng một link, một "Lỗi" một "Đang phân
  // tích". Bản cũ không phải rác cần thay — nó chỉ đang chờ một quyết định chi
  // tiền.
  app.post("/api/deconstructions/:id/retry-paid", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "Mã không hợp lệ." });
    try {
      const db = getDb();
      const [row] = await db.select().from(deconstructions).where(eq(deconstructions.id, id));
      if (!row) return res.status(404).json({ error: "Không tìm thấy bản phân tích." });
      const username = getAuthUser(req)!;
      if (row.owner !== username && !(await isActiveAdmin(username))) {
        return res.status(403).json({ error: "Không có quyền với bản phân tích này." });
      }
      if (row.status === "downloading" || row.status === "analyzing") {
        return res.status(409).json({ error: "Bản này đang chạy rồi." });
      }

      await db
        .update(deconstructions)
        .set({ status: "downloading", needsPaid: false, errorMessage: null, updatedAt: new Date() })
        .where(eq(deconstructions.id, id));

      res.json({ ...row, status: "downloading", needsPaid: false, errorMessage: null, polling: true });
      void runDeconstructInBackground(row.id, row.sourceUrl, true);
    } catch (e: any) {
      console.error("deconstruct retry paid:", e?.message || e);
      res.status(500).json({ error: "Không chạy lại được." });
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
