// Bản remake — viết lại cho brand, kèm kiểm tra guardrail (docs/PRD.md §4 J4).
//
// Việc sinh nội dung mất 10-40 giây nên chạy nền (docs/ARCH.md §4b).
// Không bao giờ trả bản nháp mà thiếu guardrailJson: người duyệt phải thấy
// được bản này có vi phạm gì không TRƯỚC khi đem dùng.
import type { Express } from "express";
import { desc, eq } from "drizzle-orm";
import { getDb, isDbConfigured } from "../db/client";
import { remakes, brands, deconstructions, type DeconstructedStructure } from "../db/schema";
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
) {
  try {
    await getDb().update(remakes).set({ status: "writing", updatedAt: new Date() }).where(eq(remakes.id, id));
    const r = await writeRemake(brand, structure, format, { sourceText, note });

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
  } catch (e: any) {
    console.error("remake (nền):", e?.message || e);
    await getDb().update(remakes)
      .set({ status: "error", errorMessage: String(e?.message || e).slice(0, 400), updatedAt: new Date() })
      .where(eq(remakes.id, id))
      .catch(() => {});
  }
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
    const format: RemakeFormat = FORMATS.includes(req.body?.format) ? req.body.format : "video_script";

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

      void runRemakeInBackground(
        row.id, toBrandContext(brand), decon.structure as DeconstructedStructure,
        format, decon.transcript,
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
