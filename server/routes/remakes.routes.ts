// Bản remake — viết lại cho brand, kèm kiểm tra guardrail (docs/PRD.md §4 J4).
//
// Việc sinh nội dung mất 10-40 giây nên chạy nền (docs/ARCH.md §4b).
// Không bao giờ trả bản nháp mà thiếu guardrailJson: người duyệt phải thấy
// được bản này có vi phạm gì không TRƯỚC khi đem dùng.
import type { Express } from "express";
import { desc, eq } from "drizzle-orm";
import { getDb, isDbConfigured } from "../db/client";
import { remakes, brands, deconstructions, type DeconstructedStructure, brandFanpages } from "../db/schema";
import { requireAuth, getAuthUser } from "../auth-mw";
import { writeRemake, type BrandContext, type RemakeFormat } from "../services/remake";
import { isActiveAdmin } from "./studio.routes";
import { toCsv, safeFilename, guardrailSummary } from "../services/export-csv";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FORMATS: RemakeFormat[] = ["video_script", "post"];

function dbDown(res: any): boolean {
  if (!isDbConfigured()) {
    res.status(503).json({ error: "Tính năng dữ liệu chưa khả dụng (thiếu DATABASE_URL)." });
    return true;
  }
  return false;
}

function toBrandContext(b: any): BrandContext {
  return {
    name: b.name,
    sells: b.sells, audience: b.audience, toneOfVoice: b.toneOfVoice,
    addressing: b.addressing, bannedTerms: b.bannedTerms, allowedClaims: b.allowedClaims,
  };
}

/** Sinh nội dung chạy nền; lỗi ghi vào bản ghi vì request đã trả về. */
export async function runRemakeInBackground(
  id: string,
  brand: BrandContext,
  structure: DeconstructedStructure,
  format: RemakeFormat,
  sourceText: string | null,
  note?: string,
  previousDraft?: string | null,
  audienceText?: string,
) {
  try {
    await getDb().update(remakes).set({ status: "writing", updatedAt: new Date() }).where(eq(remakes.id, id));
    const r = await writeRemake(brand, structure, format, { sourceText, note, audienceText });

    if (!r.draft) {
      await getDb().update(remakes)
        .set({ status: "error", errorMessage: r.warning || "Không viết được bản nháp.", updatedAt: new Date() })
        .where(eq(remakes.id, id));
      return;
    }

    // Giữ lại bản cũ khi sửa, để đối chiếu được thay đổi.
    const [current] = await getDb().select().from(remakes).where(eq(remakes.id, id));
    const revisions = Array.isArray(current?.revisionsJson) ? current.revisionsJson : [];
    if (note && previousDraft) {
      revisions.push({ at: new Date().toISOString(), note, draft: previousDraft });
    }

    await getDb().update(remakes).set({
      status: "ready",
      draft: r.draft,
      guardrailJson: r.guardrail as any,
      revisionsJson: revisions as any,
      errorMessage: r.warning || null,
      updatedAt: new Date(),
    }).where(eq(remakes.id, id));

    // Viết xong là vẽ luôn — đừng bắt bấm thêm một nút cho việc chắc chắn phải
    // làm. Chỉ bài đăng; kịch bản video đi theo luồng dựng cảnh riêng.
    if (format === "post") {
      void autoDrawImage(id).catch((e: any) =>
        console.warn("[remake] Tự vẽ ảnh thất bại:", e?.message || e),
      );
    }
  } catch (e: any) {
    console.error("remake (nền):", e?.message || e);
    await getDb().update(remakes)
      .set({ status: "error", errorMessage: String(e?.message || e).slice(0, 400), updatedAt: new Date() })
      .where(eq(remakes.id, id))
      .catch(() => {});
  }
}

/**
 * Vẽ ảnh cho bản viết vừa xong.
 *
 * Viết lại một bài để đem đăng thì gần như luôn cần ảnh — bắt bấm thêm một nút
 * cho việc chắc chắn phải làm là bắt làm thừa. Nên mặc định là VẼ, không hỏi.
 *
 * Bản trước tôi đặt thêm điều kiện "bài gốc có ảnh mới vẽ". Điều kiện đó sai ở
 * chỗ: bài gốc thuần chữ không có nghĩa bản viết lại của mình cũng thuần chữ —
 * trang của mình có nhân vật riêng và vẫn cần ảnh để đăng.
 *
 * Chỉ giữ đúng MỘT chặn: đã có ảnh rồi thì không vẽ đè, vì sửa bài lần hai
 * không được xoá ảnh người dùng đã chọn.
 */
async function autoDrawImage(remakeId: string): Promise<void> {
  const db = getDb();
  const [row] = await db.select().from(remakes).where(eq(remakes.id, remakeId));
  if (!row) return;

  const existing = Array.isArray(row.imagesJson) ? row.imagesJson : [];
  if (existing.length > 0) return;

  const { generateRemakeImage } = await import("../services/remake-image");
  await generateRemakeImage({ remakeId });
  console.log(`[remake] Đã tự vẽ ảnh cho bản viết ${remakeId}.`);
}

export function registerRemakeRoutes(app: Express) {
  app.get("/api/remakes", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const username = getAuthUser(req)!;
    try {
      const rows = await getDb().select().from(remakes).where(eq(remakes.owner, username))
        .orderBy(desc(remakes.createdAt)).limit(50);
      res.json(rows);
    } catch (e: any) {
      console.error("remakes list:", e?.message || e);
      res.status(500).json({ error: "Không tải được danh sách bản viết." });
    }
  });

  // ===== Xuất ra file CSV (docs/PRD.md §4 J6) =====
  // Mở bằng Excel hoặc nhập thẳng vào Google Sheet. Luôn kèm link bài gốc và
  // kết quả kiểm tra — người duyệt cần biết bản này học từ đâu và còn lỗi gì.
  app.get("/api/remakes/export.csv", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const username = getAuthUser(req)!;
    const ids = String(req.query.ids || "").split(",").map((x) => x.trim()).filter((x) => UUID_RE.test(x));
    try {
      const all = await getDb().select().from(remakes).where(eq(remakes.owner, username)).orderBy(desc(remakes.createdAt)).limit(500);
      const rows = ids.length ? all.filter((r) => ids.includes(r.id)) : all;

      const csv = toCsv(
        ["Ngày tạo", "Dạng", "Bài gốc", "Link bài gốc", "Kết quả kiểm tra", "Các điểm cần lưu ý", "Nội dung"],
        rows.map((r) => {
          const g = guardrailSummary(r.guardrailJson);
          return [
            new Date(r.createdAt).toLocaleString("vi-VN"),
            r.format === "post" ? "Bài đăng" : "Kịch bản video",
            r.sourceTitle || "",
            r.sourceUrl || "",
            g.status,
            g.issues,
            r.draft || "",
          ];
        }),
      );

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${safeFilename("ban-viet")}"`);
      res.send(csv);
    } catch (e: any) {
      console.error("remake export:", e?.message || e);
      res.status(500).json({ error: "Không xuất được file." });
    }
  });

  app.get("/api/remakes/:id", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "Mã không hợp lệ." });
    try {
      const [row] = await getDb().select().from(remakes).where(eq(remakes.id, id));
      if (!row) return res.status(404).json({ error: "Không tìm thấy bản viết." });
      const username = getAuthUser(req)!;
      if (row.owner !== username && !(await isActiveAdmin(username))) {
        return res.status(403).json({ error: "Không có quyền xem bản viết này." });
      }
      res.json(row);
    } catch (e: any) {
      console.error("remake get:", e?.message || e);
      res.status(500).json({ error: "Không tải được bản viết." });
    }
  });

  // ===== Tạo bản remake =====
  app.post("/api/remakes", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const username = getAuthUser(req)!;
    const brandId = String(req.body?.brandId || "");
    const deconstructionId = String(req.body?.deconstructionId || "");
    // Mặc định là BÀI ĐĂNG: phần lớn việc ở đây là viết lại bài, còn kịch bản
    // video là nhánh phụ và đang chưa ổn định.
    const format: RemakeFormat = FORMATS.includes(req.body?.format) ? req.body.format : "post";

    if (!UUID_RE.test(brandId)) return res.status(400).json({ error: "Chọn thương hiệu muốn viết cho." });
    if (!UUID_RE.test(deconstructionId)) return res.status(400).json({ error: "Chọn bài đã bóc cấu trúc để học theo." });

    try {
      const [brand] = await getDb().select().from(brands).where(eq(brands.id, brandId));
      if (!brand) return res.status(404).json({ error: "Không tìm thấy thương hiệu." });

      const [decon] = await getDb().select().from(deconstructions).where(eq(deconstructions.id, deconstructionId));
      if (!decon) return res.status(404).json({ error: "Không tìm thấy bản phân tích." });
      if (decon.status !== "ready" || !decon.structure) {
        return res.status(400).json({ error: "Bài này chưa bóc xong cấu trúc, chưa viết lại được." });
      }

      // Cảnh báo sớm: hồ sơ brand rỗng thì bản viết sẽ chung chung.
      const hasBrandData = !!(brand.sells || brand.audience || brand.toneOfVoice);
      const [row] = await getDb().insert(remakes).values({
        owner: username, brandId, deconstructionId, format, status: "pending",
        sourceUrl: decon.sourceUrl, sourceTitle: decon.title,
      }).returning();

      res.status(201).json({
        ...row, polling: true,
        message: "Đang viết bản mới. Việc này mất khoảng 10-40 giây.",
        hint: hasBrandData ? undefined : "Hồ sơ thương hiệu còn trống nên bản viết sẽ chung chung. Nạp tài liệu ở mục Thương hiệu để kết quả sát hơn.",
      });

      // Bản bóc đã phân tích bình luận thì đưa luôn vào: viết bám mối quan tâm
      // của người đọc trúng hơn bám nội dung bài gốc.
      const { insightToText } = await import("../services/audience-insight");
      const audienceText = decon.audienceInsight ? insightToText(decon.audienceInsight as any) : undefined;

      // Chữ trong ảnh đi kèm cấu trúc: bài caption một dòng mà ảnh đầy chữ thì
      // phần đáng học nằm hết ở ảnh.
      const { imageReadingToText } = await import("../services/image-read");
      const imageText = decon.imageReading ? imageReadingToText(decon.imageReading as any) : undefined;

      void runRemakeInBackground(
        row.id, toBrandContext(brand), decon.structure as DeconstructedStructure,
        format, decon.transcript, undefined, undefined,
        [audienceText, imageText].filter(Boolean).join("\n\n") || undefined,
      );
    } catch (e: any) {
      console.error("remake create:", e?.message || e);
      res.status(500).json({ error: "Không tạo được bản viết." });
    }
  });

  // ===== Yêu cầu chỉnh sửa =====
  app.post("/api/remakes/:id/revise", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "Mã không hợp lệ." });
    const note = String(req.body?.note || "").trim();
    if (!note) return res.status(400).json({ error: "Nói rõ bạn muốn chỉnh gì." });

    try {
      const [row] = await getDb().select().from(remakes).where(eq(remakes.id, id));
      if (!row) return res.status(404).json({ error: "Không tìm thấy bản viết." });
      const username = getAuthUser(req)!;
      if (row.owner !== username && !(await isActiveAdmin(username))) {
        return res.status(403).json({ error: "Không có quyền sửa bản viết này." });
      }
      if (row.status === "writing") return res.status(409).json({ error: "Bản viết đang được xử lý, chờ một chút." });

      const [brand] = await getDb().select().from(brands).where(eq(brands.id, row.brandId));
      if (!brand) return res.status(404).json({ error: "Không tìm thấy thương hiệu." });
      const [decon] = row.deconstructionId
        ? await getDb().select().from(deconstructions).where(eq(deconstructions.id, row.deconstructionId))
        : [null as any];

      res.json({ ...row, status: "writing", polling: true, message: "Đang chỉnh lại bản viết." });

      void runRemakeInBackground(
        id, toBrandContext(brand), (decon?.structure || {}) as DeconstructedStructure,
        row.format as RemakeFormat, decon?.transcript ?? null, note, row.draft,
      );
    } catch (e: any) {
      console.error("remake revise:", e?.message || e);
      res.status(500).json({ error: "Không chỉnh được bản viết." });
    }
  });

  // ===== Kiểm tra lại guardrail sau khi người dùng tự sửa tay =====
  app.post("/api/remakes/:id/recheck", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "Mã không hợp lệ." });
    const draft = typeof req.body?.draft === "string" ? req.body.draft : null;

    try {
      const [row] = await getDb().select().from(remakes).where(eq(remakes.id, id));
      if (!row) return res.status(404).json({ error: "Không tìm thấy bản viết." });
      const username = getAuthUser(req)!;
      if (row.owner !== username && !(await isActiveAdmin(username))) {
        return res.status(403).json({ error: "Không có quyền sửa bản viết này." });
      }

      const [brand] = await getDb().select().from(brands).where(eq(brands.id, row.brandId));
      const [decon] = row.deconstructionId
        ? await getDb().select().from(deconstructions).where(eq(deconstructions.id, row.deconstructionId))
        : [null as any];

      const text = draft ?? row.draft ?? "";
      if (!text.trim()) return res.status(400).json({ error: "Chưa có nội dung để kiểm tra." });

      const { runGuardrail } = await import("../services/guardrail");
      const report = runGuardrail(text, {
        sourceText: decon?.transcript ?? null,
        brand: brand ? toBrandContext(brand) : null,
      });

      const [updated] = await getDb().update(remakes)
        .set({ draft: text, guardrailJson: report as any, updatedAt: new Date() })
        .where(eq(remakes.id, id)).returning();
      res.json(updated);
    } catch (e: any) {
      console.error("remake recheck:", e?.message || e);
      res.status(500).json({ error: "Không kiểm tra lại được." });
    }
  });

  // ===== Đăng lên fanpage =====
  // Chỉ đăng lên trang đã nối Meta trong hồ sơ thương hiệu — không nhận page id
  // tuỳ ý từ client, để không ai đăng nhầm lên trang người khác.
  app.get("/api/remakes/:id/publish-targets", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "Mã không hợp lệ." });
    try {
      const [row] = await getDb().select().from(remakes).where(eq(remakes.id, id));
      if (!row) return res.status(404).json({ error: "Không tìm thấy bản viết." });

      const pages = await getDb().select().from(brandFanpages).where(eq(brandFanpages.brandId, row.brandId));
      const targets = pages
        .filter((p) => !!p.metaTokenEnc && !!p.metaPageId)
        .map((p) => ({
          fanpageId: p.id,
          pageName: p.pageName || p.pageUrl,
          platform: p.platform,
          pictureUrl: p.metaPictureUrl,
        }));

      res.json({
        targets,
        // Nói rõ vì sao danh sách trống, thay vì để người dùng đoán.
        note:
          targets.length === 0
            ? "Chưa trang nào nối Meta. Vào Thương hiệu → Trang của thương hiệu → Nối Meta trước."
            : undefined,
      });
    } catch (e: any) {
      console.error("publish targets:", e?.message || e);
      res.status(500).json({ error: "Không tải được danh sách trang." });
    }
  });

  app.post("/api/remakes/:id/publish", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "Mã không hợp lệ." });
    const fanpageId = String(req.body?.fanpageId || "").trim();
    if (!UUID_RE.test(fanpageId)) return res.status(400).json({ error: "Chưa chọn trang để đăng." });

    try {
      const [row] = await getDb().select().from(remakes).where(eq(remakes.id, id));
      if (!row) return res.status(404).json({ error: "Không tìm thấy bản viết." });
      if (!row.draft?.trim()) return res.status(400).json({ error: "Bản viết chưa có nội dung." });

      const username = getAuthUser(req)!;
      if (row.owner !== username && !(await isActiveAdmin(username))) {
        return res.status(403).json({ error: "Không có quyền đăng bản viết này." });
      }

      const [page] = await getDb().select().from(brandFanpages).where(eq(brandFanpages.id, fanpageId));
      if (!page || page.brandId !== row.brandId) {
        return res.status(400).json({ error: "Trang này không thuộc thương hiệu của bản viết." });
      }
      if (!page.metaTokenEnc || !page.metaPageId) {
        return res.status(400).json({ error: "Trang chưa nối Meta." });
      }

      // Đã đăng lên đúng trang này rồi thì chặn — bấm hai lần là chuyện thường.
      const already = (row.publishedJson || []).find((p) => p.fanpageId === fanpageId);
      if (already && !req.body?.force) {
        return res.status(409).json({
          error: `Bản viết này đã đăng lên "${already.pageName || "trang này"}" ngày ${new Date(already.publishedAt).toLocaleDateString("vi-VN")}.`,
          permalink: already.permalink,
        });
      }

      const scheduledAt = req.body?.scheduledAt ? new Date(req.body.scheduledAt) : null;
      if (scheduledAt && isNaN(scheduledAt.getTime())) {
        return res.status(400).json({ error: "Thời điểm hẹn giờ không hợp lệ." });
      }

      const { publishToPage } = await import("../services/meta-publish");
      const out = await publishToPage({
        pageId: page.metaPageId,
        tokenEnc: page.metaTokenEnc,
        message: row.draft,
        imageUrl: row.selectedImageUrl,
        scheduledAt,
      });

      const record = {
        fanpageId,
        pageName: page.pageName || page.pageUrl,
        postId: out.postId,
        permalink: out.permalink,
        publishedAt: new Date().toISOString(),
        scheduled: out.scheduled,
        scheduledFor: scheduledAt ? scheduledAt.toISOString() : undefined,
      };
      await getDb()
        .update(remakes)
        .set({ publishedJson: [...(row.publishedJson || []), record], updatedAt: new Date() })
        .where(eq(remakes.id, id));

      res.json(record);
    } catch (e: any) {
      console.warn("publish remake:", e?.message || e);
      res.status(400).json({ error: e?.message || "Không đăng được bài." });
    }
  });

  // ===== Vẽ ảnh cho bản viết =====
  // Vẽ mất khoảng 10-30 giây, dưới ngưỡng proxy cắt (60s) nên gọi thẳng, không
  // cần cơ chế việc chạy nền như bên dựng video.
  app.post("/api/remakes/:id/image", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "Mã không hợp lệ." });
    try {
      const [row] = await getDb().select().from(remakes).where(eq(remakes.id, id));
      if (!row) return res.status(404).json({ error: "Không tìm thấy bản viết." });
      const username = getAuthUser(req)!;
      if (row.owner !== username && !(await isActiveAdmin(username))) {
        return res.status(403).json({ error: "Không có quyền sửa bản viết này." });
      }

      const { generateRemakeImage } = await import("../services/remake-image");
      const out = await generateRemakeImage({
        remakeId: id,
        aspectRatio: typeof req.body?.aspectRatio === "string" ? req.body.aspectRatio : undefined,
        customPrompt: typeof req.body?.prompt === "string" ? req.body.prompt : undefined,
      });
      res.json(out);
    } catch (e: any) {
      console.warn("remake image:", e?.message || e);
      res.status(400).json({ error: e?.message || "Không vẽ được ảnh." });
    }
  });

  // Chỉnh ảnh bằng lời, có thể khoanh vùng — dùng chung cơ chế với trang Sáng
  // tạo. Trước đây ảnh của Remake vẽ xong là xong, muốn đổi chi tiết nhỏ phải
  // vẽ lại từ đầu và mất luôn bố cục vừa ưng.
  app.post("/api/remakes/:id/image/edit", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "Mã không hợp lệ." });
    const instruction = String(req.body?.instruction || "").trim();
    if (!instruction) return res.status(400).json({ error: "Chưa nói cần chỉnh gì." });

    try {
      const [row] = await getDb().select().from(remakes).where(eq(remakes.id, id));
      if (!row) return res.status(404).json({ error: "Không tìm thấy bản viết." });
      const username = getAuthUser(req)!;
      if (row.owner !== username && !(await isActiveAdmin(username))) {
        return res.status(403).json({ error: "Không có quyền sửa bản viết này." });
      }

      const images = (row.imagesJson || []) as any[];
      const targetUrl = String(req.body?.imageUrl || row.selectedImageUrl || images[images.length - 1]?.url || "");
      const current = images.find((i) => i.url === targetUrl);
      if (!targetUrl || !current) return res.status(400).json({ error: "Chưa có ảnh để chỉnh." });

      const { internalKeyFromUrl, storage, persistDataUrl } = await import("../storage");
      const key = internalKeyFromUrl(targetUrl);
      if (!key) return res.status(400).json({ error: "Không đọc được ảnh gốc." });
      const buf = await storage.get(key);

      const maskRaw = typeof req.body?.mask === "string" ? req.body.mask : "";
      let maskImage: { mimeType: string; data: string } | null = null;
      if (maskRaw.startsWith("data:image/")) {
        const m = maskRaw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
        if (m) maskImage = { mimeType: m[1], data: m[2] };
      }

      const { editImage } = await import("../services/social-proxy");
      const result = await editImage({
        sourceImage: { mimeType: "image/png", data: buf.toString("base64") },
        instruction,
        aspectRatio: current.aspectRatio || "1:1",
        // Mô tả đã tạo ra ảnh này — để model hiểu bối cảnh gốc khi chỉnh tiếp.
        previousContext: current.prompt,
        maskImage,
      });
      if (result.isDemo) {
        return res.status(502).json({ error: result.warning || "Không chỉnh được ảnh." });
      }

      const newUrl = (await persistDataUrl("remakes", result.url)) || result.url;
      const newImage = {
        url: newUrl,
        // Giữ dấu vết đã chỉnh gì, để lần sau nhìn lại còn hiểu.
        prompt: `${current.prompt}\n[đã chỉnh] ${instruction}${maskImage ? " (vùng khoanh)" : ""}`,
        aspectRatio: current.aspectRatio || "1:1",
        createdAt: new Date().toISOString(),
      };

      await getDb()
        .update(remakes)
        .set({ imagesJson: [...images, newImage], selectedImageUrl: newUrl, updatedAt: new Date() })
        .where(eq(remakes.id, id));

      res.json({ image: newImage });
    } catch (e: any) {
      console.warn("remake image edit:", e?.message || e);
      res.status(400).json({ error: e?.message || "Không chỉnh được ảnh." });
    }
  });

  // Chọn lại một ảnh đã vẽ trước đó.
  app.post("/api/remakes/:id/select-image", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "Mã không hợp lệ." });
    const url = typeof req.body?.url === "string" ? req.body.url.trim() : "";
    if (!url) return res.status(400).json({ error: "Cần url ảnh." });
    try {
      const [row] = await getDb().select().from(remakes).where(eq(remakes.id, id));
      if (!row) return res.status(404).json({ error: "Không tìm thấy bản viết." });
      const username = getAuthUser(req)!;
      if (row.owner !== username && !(await isActiveAdmin(username))) {
        return res.status(403).json({ error: "Không có quyền sửa bản viết này." });
      }
      // Chỉ nhận ảnh đã thuộc bản viết này — không để client trỏ sang ảnh bất kỳ.
      const images = (row.imagesJson as any[]) || [];
      if (!images.some((img) => img.url === url)) {
        return res.status(400).json({ error: "Ảnh này không thuộc bản viết." });
      }
      const [updated] = await getDb().update(remakes)
        .set({ selectedImageUrl: url, updatedAt: new Date() })
        .where(eq(remakes.id, id))
        .returning();
      res.json(updated);
    } catch (e: any) {
      console.error("remake select image:", e?.message || e);
      res.status(500).json({ error: "Không chọn được ảnh." });
    }
  });

  // DELETE /api/remakes/:id/images?url=... — xoá MỘT ảnh của bản viết.
  //
  // Thư viện ảnh trước đây chỉ xem và tải về, không xoá được: ảnh vẽ hỏng nằm
  // lại mãi, và mỗi lần vẽ thêm phương án là kho lại dày lên. Xoá luôn cả file
  // trong kho để không giữ rác.
  app.delete("/api/remakes/:id/images", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "Mã không hợp lệ." });
    const url = typeof req.query.url === "string" ? req.query.url : "";
    if (!url) return res.status(400).json({ error: "Thiếu đường dẫn ảnh." });

    try {
      const db = getDb();
      const [row] = await db.select().from(remakes).where(eq(remakes.id, id));
      if (!row) return res.status(404).json({ error: "Không tìm thấy bản viết." });
      const me = getAuthUser(req)!;
      if (row.owner !== me && !(await isActiveAdmin(me))) {
        return res.status(403).json({ error: "Không có quyền với bản viết này." });
      }

      const images = ((row.imagesJson as any[]) || []).filter((img) => img?.url !== url);
      const patch: Record<string, any> = { imagesJson: images, updatedAt: new Date() };
      // Xoá đúng ảnh đang được chọn thì bỏ chọn, đừng để trỏ vào ảnh không còn.
      if (row.selectedImageUrl === url) patch.selectedImageUrl = images[0]?.url ?? null;
      await db.update(remakes).set(patch).where(eq(remakes.id, id));

      const { storage, internalKeyFromUrl } = await import("../storage");
      const key = internalKeyFromUrl(url);
      if (key) await storage.delete(key).catch(() => {});

      res.json({ ok: true, remaining: images.length });
    } catch (e: any) {
      console.error("delete remake image:", e?.message || e);
      res.status(500).json({ error: "Xoá ảnh thất bại." });
    }
  });

  app.delete("/api/remakes/:id", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "Mã không hợp lệ." });
    try {
      const [row] = await getDb().select().from(remakes).where(eq(remakes.id, id));
      if (!row) return res.status(404).json({ error: "Không tìm thấy bản viết." });
      const username = getAuthUser(req)!;
      if (row.owner !== username && !(await isActiveAdmin(username))) {
        return res.status(403).json({ error: "Không có quyền xoá." });
      }
      await getDb().delete(remakes).where(eq(remakes.id, id));
      res.json({ success: true });
    } catch (e: any) {
      console.error("remake delete:", e?.message || e);
      res.status(500).json({ error: "Không xoá được." });
    }
  });
}
