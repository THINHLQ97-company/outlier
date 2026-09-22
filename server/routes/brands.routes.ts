// Brand Profile — hồ sơ thương hiệu bóc từ tài liệu thật, MỖI FIELD KÈM TRÍCH DẪN.
//
// Nguyên tắc P1 (docs/PRD.md §2): không có evidence thì không ghi field. Việc
// kiểm chứng nằm ở brand-extract.ts (đối chiếu câu trích ngược lại tài liệu);
// route này chỉ điều phối và lưu kết quả đã được lọc.
//
// Quyền: xem = owner==user | isShared. Sửa/xoá = owner hoặc admin.
// Thiếu GEMINI_API_KEY → bóc trả hồ sơ rỗng + warning, KHÔNG crash (CLAUDE.md mục 3).
import type { Express } from "express";
import { and, desc, eq, or } from "drizzle-orm";
import { getDb, isDbConfigured } from "../db/client";
import { brands, brandSources, brandFanpages } from "../db/schema";
import { requireAuth, getAuthUser } from "../auth-mw";
import { ingestUrl, ingestRawText, ingestPdfBuffer, assertPublicUrl } from "../services/brand-ingest";
import { extractBrandProfile, type SourceDoc } from "../services/brand-extract";
import { isActiveAdmin } from "./studio.routes";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PDF_BYTES = 10 * 1024 * 1024;

/** Đoán nền tảng từ link để người dùng khỏi phải chọn tay. */
function guessFanpagePlatform(url: string): string | null {
  const u = url.toLowerCase();
  if (u.includes("facebook.com") || u.includes("fb.com")) return "facebook";
  if (u.includes("tiktok.com")) return "tiktok";
  if (u.includes("youtube.com") || u.includes("youtu.be")) return "youtube";
  if (u.includes("instagram.com")) return "instagram";
  if (u.includes("threads.net") || u.includes("threads.com")) return "threads";
  if (u.includes("zalo.me")) return "zalo";
  if (u.includes("linkedin.com")) return "linkedin";
  return null;
}

function dbDown(res: any): boolean {
  if (!isDbConfigured()) {
    res.status(503).json({ error: "Tính năng dữ liệu chưa khả dụng (thiếu DATABASE_URL)." });
    return true;
  }
  return false;
}

async function canEdit(req: any, row: { owner: string }): Promise<boolean> {
  const username = getAuthUser(req);
  if (!username) return false;
  if (row.owner === username) return true;
  return isActiveAdmin(username);
}

export function registerBrandRoutes(app: Express) {
  // ===== Danh sách brand =====
  app.get("/api/brands", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const username = getAuthUser(req)!;
    try {
      const rows = await getDb()
        .select()
        .from(brands)
        .where(or(eq(brands.owner, username), eq(brands.isShared, true)))
        .orderBy(desc(brands.updatedAt));
      res.json(rows);
    } catch (e: any) {
      console.error("brands list:", e?.message || e);
      res.status(500).json({ error: "Không tải được danh sách thương hiệu." });
    }
  });

  // ===== Một brand + tài liệu nguồn =====
  app.get("/api/brands/:id", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "Mã thương hiệu không hợp lệ." });
    try {
      const [row] = await getDb().select().from(brands).where(eq(brands.id, id));
      if (!row) return res.status(404).json({ error: "Không tìm thấy thương hiệu." });
      const sources = await getDb()
        .select({
          id: brandSources.id, kind: brandSources.kind, sourceUrl: brandSources.sourceUrl,
          title: brandSources.title, charCount: brandSources.charCount,
          status: brandSources.status, errorMessage: brandSources.errorMessage,
          createdAt: brandSources.createdAt,
        })
        .from(brandSources)
        .where(eq(brandSources.brandId, id))
        .orderBy(desc(brandSources.createdAt));
      const fanpages = await getDb().select().from(brandFanpages)
        .where(eq(brandFanpages.brandId, id))
        .orderBy(desc(brandFanpages.isPrimary), desc(brandFanpages.createdAt));
      res.json({ ...row, sources, fanpages });
    } catch (e: any) {
      console.error("brand get:", e?.message || e);
      res.status(500).json({ error: "Không tải được thương hiệu." });
    }
  });

  // ===== Tạo brand =====
  app.post("/api/brands", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const username = getAuthUser(req)!;
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ error: "Thiếu tên thương hiệu." });
    try {
      const [row] = await getDb()
        .insert(brands)
        .values({ owner: username, name, isShared: req.body?.isShared !== false })
        .returning();
      res.status(201).json(row);
    } catch (e: any) {
      console.error("brand create:", e?.message || e);
      res.status(500).json({ error: "Không tạo được thương hiệu." });
    }
  });

  // ===== Thêm tài liệu nguồn (link / văn bản dán tay) =====
  app.post("/api/brands/:id/sources", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "Mã thương hiệu không hợp lệ." });
    try {
      const [brand] = await getDb().select().from(brands).where(eq(brands.id, id));
      if (!brand) return res.status(404).json({ error: "Không tìm thấy thương hiệu." });
      if (!(await canEdit(req, brand))) return res.status(403).json({ error: "Không có quyền sửa thương hiệu này." });

      const url = typeof req.body?.url === "string" ? req.body.url.trim() : "";
      const text = typeof req.body?.text === "string" ? req.body.text : "";
      if (!url && !text) return res.status(400).json({ error: "Cần dán link hoặc nội dung." });

      let result, kind: string;
      try {
        if (url) { result = await ingestUrl(url); kind = "website"; }
        else { result = ingestRawText(text); kind = "text"; }
      } catch (e: any) {
        // Lỗi nạp là lỗi người dùng hiểu được → 400 kèm câu giải thích, không phải 500.
        return res.status(400).json({ error: e?.message || "Không đọc được tài liệu." });
      }

      const [row] = await getDb()
        .insert(brandSources)
        .values({
          brandId: id, kind, sourceUrl: url || null,
          title: result.title || null, extractedText: result.text,
          charCount: result.charCount, status: "ready",
        })
        .returning({
          id: brandSources.id, kind: brandSources.kind, sourceUrl: brandSources.sourceUrl,
          title: brandSources.title, charCount: brandSources.charCount, status: brandSources.status,
        });
      res.status(201).json(row);
    } catch (e: any) {
      console.error("brand source add:", e?.message || e);
      res.status(500).json({ error: "Không thêm được tài liệu." });
    }
  });

  // ===== Tải PDF lên (gửi base64 trong JSON, giống cách app đang làm với ảnh) =====
  app.post("/api/brands/:id/sources/pdf", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "Mã thương hiệu không hợp lệ." });
    try {
      const [brand] = await getDb().select().from(brands).where(eq(brands.id, id));
      if (!brand) return res.status(404).json({ error: "Không tìm thấy thương hiệu." });
      if (!(await canEdit(req, brand))) return res.status(403).json({ error: "Không có quyền sửa thương hiệu này." });

      const raw = String(req.body?.dataBase64 || "").replace(/^data:[^;]+;base64,/, "");
      if (!raw) return res.status(400).json({ error: "Thiếu nội dung file." });
      const buf = Buffer.from(raw, "base64");
      if (buf.length === 0) return res.status(400).json({ error: "File rỗng hoặc sai định dạng." });
      if (buf.length > MAX_PDF_BYTES) return res.status(400).json({ error: "File quá lớn (tối đa 10MB)." });

      let result;
      try {
        result = await ingestPdfBuffer(buf);
      } catch (e: any) {
        return res.status(400).json({ error: e?.message || "Không đọc được PDF." });
      }

      const [row] = await getDb()
        .insert(brandSources)
        .values({
          brandId: id, kind: "pdf", sourceUrl: null,
          title: result.title || String(req.body?.filename || "").trim() || null,
          extractedText: result.text, charCount: result.charCount, status: "ready",
        })
        .returning({
          id: brandSources.id, kind: brandSources.kind, title: brandSources.title,
          charCount: brandSources.charCount, status: brandSources.status,
        });
      res.status(201).json(row);
    } catch (e: any) {
      console.error("brand pdf:", e?.message || e);
      res.status(500).json({ error: "Không tải được PDF." });
    }
  });

  // ===== Bóc hồ sơ từ toàn bộ tài liệu đã nạp =====
  app.post("/api/brands/:id/extract", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "Mã thương hiệu không hợp lệ." });
    try {
      const [brand] = await getDb().select().from(brands).where(eq(brands.id, id));
      if (!brand) return res.status(404).json({ error: "Không tìm thấy thương hiệu." });
      if (!(await canEdit(req, brand))) return res.status(403).json({ error: "Không có quyền sửa thương hiệu này." });

      const sources = await getDb().select().from(brandSources).where(eq(brandSources.brandId, id));
      const docs: SourceDoc[] = sources
        .filter((s) => s.status === "ready" && s.extractedText)
        .map((s) => ({ id: s.id, url: s.sourceUrl || undefined, text: s.extractedText }));

      if (docs.length === 0) {
        return res.status(400).json({ error: "Chưa có tài liệu nào để bóc. Thêm link, PDF hoặc dán nội dung trước." });
      }

      await getDb().update(brands).set({ ingestStatus: "running", updatedAt: new Date() }).where(eq(brands.id, id));
      const profile = await extractBrandProfile(docs);

      // Chỉ ghi đè field bóc được; field người dùng đã sửa tay (source="manual") giữ nguyên.
      const keep = <T,>(cur: any, next: T | null) => (cur?.source === "manual" ? cur : next);
      const [row] = await getDb()
        .update(brands)
        .set({
          sells: keep(brand.sells, profile.sells),
          audience: keep(brand.audience, profile.audience),
          toneOfVoice: keep(brand.toneOfVoice, profile.toneOfVoice),
          addressing: keep(brand.addressing, profile.addressing),
          bannedTerms: keep(brand.bannedTerms, profile.bannedTerms),
          allowedClaims: keep(brand.allowedClaims, profile.allowedClaims),
          ingestStatus: "ready",
          updatedAt: new Date(),
        })
        .where(eq(brands.id, id))
        .returning();

      // `rejected` = field model khai nhưng không kiểm chứng được. Trả cho người
      // dùng biết VÌ SAO thiếu, thay vì im lặng để trống.
      res.json({ ...row, rejected: profile.rejected });
    } catch (e: any) {
      console.error("brand extract:", e?.message || e);
      await getDb().update(brands).set({ ingestStatus: "error", updatedAt: new Date() }).where(eq(brands.id, req.params.id)).catch(() => {});
      res.status(500).json({ error: "Không bóc được hồ sơ thương hiệu." });
    }
  });

  // ===== Sửa tay một field (miễn evidence, đánh dấu source="manual") =====
  app.patch("/api/brands/:id", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "Mã thương hiệu không hợp lệ." });
    const EDITABLE = [
      "sells", "audience", "toneOfVoice", "addressing", "bannedTerms", "allowedClaims",
      // Tính cách thường do người dùng tự quyết chứ không bóc từ tài liệu,
      // nên hay được nhập tay — vẫn đi qua cùng một đường để nhất quán.
      "personality", "contentPillars", "trendDos", "trendDonts",
    ] as const;
    try {
      const [brand] = await getDb().select().from(brands).where(eq(brands.id, id));
      if (!brand) return res.status(404).json({ error: "Không tìm thấy thương hiệu." });
      if (!(await canEdit(req, brand))) return res.status(403).json({ error: "Không có quyền sửa thương hiệu này." });

      const patch: Record<string, any> = { updatedAt: new Date() };
      if (typeof req.body?.name === "string" && req.body.name.trim()) patch.name = req.body.name.trim();
      if (typeof req.body?.isShared === "boolean") patch.isShared = req.body.isShared;

      for (const f of EDITABLE) {
        if (!(f in (req.body || {}))) continue;
        const v = req.body[f];
        if (v === null) { patch[f] = null; continue; } // xoá field
        // Người dùng tự nhập → không cần evidence, nhưng phải ghi rõ là nhập tay
        patch[f] = { value: v?.value ?? v, evidence: [], source: "manual", note: v?.note };
      }

      const [row] = await getDb().update(brands).set(patch).where(eq(brands.id, id)).returning();
      res.json(row);
    } catch (e: any) {
      console.error("brand patch:", e?.message || e);
      res.status(500).json({ error: "Không lưu được thay đổi." });
    }
  });

  // ===== Xoá tài liệu nguồn =====
  app.delete("/api/brands/:id/sources/:sourceId", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id, sourceId } = req.params;
    if (!UUID_RE.test(id) || !UUID_RE.test(sourceId)) return res.status(400).json({ error: "Mã không hợp lệ." });
    try {
      const [brand] = await getDb().select().from(brands).where(eq(brands.id, id));
      if (!brand) return res.status(404).json({ error: "Không tìm thấy thương hiệu." });
      if (!(await canEdit(req, brand))) return res.status(403).json({ error: "Không có quyền sửa thương hiệu này." });
      await getDb().delete(brandSources).where(and(eq(brandSources.id, sourceId), eq(brandSources.brandId, id)));
      res.json({ success: true });
    } catch (e: any) {
      console.error("brand source delete:", e?.message || e);
      res.status(500).json({ error: "Không xoá được tài liệu." });
    }
  });

  // ===== Trang/kênh CỦA CHÍNH thương hiệu =====
  // Khác "Kênh theo dõi" (soi đối thủ): đây là nơi thương hiệu đăng bài. Claude
  // cần biết để gợi ý đu trend cho đúng chỗ, đúng định dạng, đúng người đọc.
  app.post("/api/brands/:id/fanpages", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "Mã thương hiệu không hợp lệ." });
    try {
      const [brand] = await getDb().select().from(brands).where(eq(brands.id, id));
      if (!brand) return res.status(404).json({ error: "Không tìm thấy thương hiệu." });
      if (!(await canEdit(req, brand))) return res.status(403).json({ error: "Không có quyền sửa thương hiệu này." });

      const pageUrl = String(req.body?.pageUrl || "").trim();
      if (!pageUrl) return res.status(400).json({ error: "Dán link trang của bạn." });
      try { assertPublicUrl(pageUrl); }
      catch (e: any) { return res.status(400).json({ error: e?.message || "Link không hợp lệ." }); }

      const platform = String(req.body?.platform || "").trim() || guessFanpagePlatform(pageUrl);
      if (!platform) return res.status(400).json({ error: "Không nhận ra trang thuộc nền tảng nào." });

      const arr = (v: any) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : []);
      const [row] = await getDb().insert(brandFanpages).values({
        brandId: id, platform, pageUrl,
        pageName: String(req.body?.pageName || "").trim() || null,
        handle: String(req.body?.handle || "").trim() || null,
        followerCount: Number.isFinite(Number(req.body?.followerCount)) ? Number(req.body.followerCount) : null,
        topics: arr(req.body?.topics), formats: arr(req.body?.formats),
        postingCadence: String(req.body?.postingCadence || "").trim() || null,
        audienceNote: String(req.body?.audienceNote || "").trim() || null,
        note: String(req.body?.note || "").trim() || null,
        isPrimary: req.body?.isPrimary === true,
      }).returning();
      res.status(201).json(row);
    } catch (e: any) {
      console.error("fanpage add:", e?.message || e);
      res.status(500).json({ error: "Không thêm được trang." });
    }
  });

  app.patch("/api/brands/:id/fanpages/:fid", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id, fid } = req.params;
    if (!UUID_RE.test(id) || !UUID_RE.test(fid)) return res.status(400).json({ error: "Mã không hợp lệ." });
    try {
      const [brand] = await getDb().select().from(brands).where(eq(brands.id, id));
      if (!brand) return res.status(404).json({ error: "Không tìm thấy thương hiệu." });
      if (!(await canEdit(req, brand))) return res.status(403).json({ error: "Không có quyền sửa." });

      const patch: Record<string, any> = { updatedAt: new Date() };
      for (const k of ["pageName", "handle", "postingCadence", "audienceNote", "note", "platform"]) {
        if (typeof req.body?.[k] === "string") patch[k] = req.body[k].trim() || null;
      }
      for (const k of ["topics", "formats"]) {
        if (Array.isArray(req.body?.[k])) patch[k] = req.body[k].map((x: any) => String(x).trim()).filter(Boolean);
      }
      if (req.body?.followerCount !== undefined) {
        const n = Number(req.body.followerCount);
        patch.followerCount = Number.isFinite(n) && n >= 0 ? n : null;
      }
      if (typeof req.body?.isPrimary === "boolean") patch.isPrimary = req.body.isPrimary;

      const [row] = await getDb().update(brandFanpages)
        .set(patch)
        .where(and(eq(brandFanpages.id, fid), eq(brandFanpages.brandId, id)))
        .returning();
      if (!row) return res.status(404).json({ error: "Không tìm thấy trang." });
      res.json(row);
    } catch (e: any) {
      console.error("fanpage patch:", e?.message || e);
      res.status(500).json({ error: "Không lưu được thay đổi." });
    }
  });

  app.delete("/api/brands/:id/fanpages/:fid", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id, fid } = req.params;
    if (!UUID_RE.test(id) || !UUID_RE.test(fid)) return res.status(400).json({ error: "Mã không hợp lệ." });
    try {
      const [brand] = await getDb().select().from(brands).where(eq(brands.id, id));
      if (!brand) return res.status(404).json({ error: "Không tìm thấy thương hiệu." });
      if (!(await canEdit(req, brand))) return res.status(403).json({ error: "Không có quyền xoá." });
      await getDb().delete(brandFanpages).where(and(eq(brandFanpages.id, fid), eq(brandFanpages.brandId, id)));
      res.json({ success: true });
    } catch (e: any) {
      console.error("fanpage delete:", e?.message || e);
      res.status(500).json({ error: "Không xoá được trang." });
    }
  });

  // ===== Xoá brand =====
  app.delete("/api/brands/:id", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "Mã thương hiệu không hợp lệ." });
    try {
      const [brand] = await getDb().select().from(brands).where(eq(brands.id, id));
      if (!brand) return res.status(404).json({ error: "Không tìm thấy thương hiệu." });
      if (!(await canEdit(req, brand))) return res.status(403).json({ error: "Không có quyền xoá thương hiệu này." });
      await getDb().delete(brandSources).where(eq(brandSources.brandId, id));
      await getDb().delete(brands).where(eq(brands.id, id));
      res.json({ success: true });
    } catch (e: any) {
      console.error("brand delete:", e?.message || e);
      res.status(500).json({ error: "Không xoá được thương hiệu." });
    }
  });
}
