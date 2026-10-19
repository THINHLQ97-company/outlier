// Danh mục bài trang nhà + quảng cáo đang chạy + đơn đặt quảng cáo (task #6843).
//
// Quyền: ai đăng nhập cũng XEM bài, XEM đơn, ĐẶT đơn — cả team cần biết bài
// nào đang chạy quảng cáo và đã có ai đặt chưa. Đổi trạng thái đơn: người
// chạy quảng cáo (một người cố định admin chọn) và admin; người đặt chỉ huỷ
// được đơn của mình khi đơn còn "chờ chạy".
import type { Express } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, isDbConfigured } from "../db/client";
import { adOrders, brandFanpages, brands, fanpagePosts, users } from "../db/schema";
import { requireAdmin, requireAuth, getAuthUser } from "../auth-mw";
import { isActiveAdmin } from "./studio.routes";
import { allSettings, setSetting } from "../services/app-settings";
import { AD_ORDER_STATUSES, type AdOrderStatus } from "../services/fanpage-ads";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ADS_RUNNER_KEY = "ads_runner_username";

function dbDown(res: any): boolean {
  if (!isDbConfigured()) {
    res.status(503).json({ error: "Tính năng dữ liệu chưa khả dụng (thiếu DATABASE_URL)." });
    return true;
  }
  return false;
}

async function adsRunner(): Promise<string | null> {
  return (await allSettings())[ADS_RUNNER_KEY] || null;
}

/**
 * Ai được đổi đơn sang trạng thái nào. Thuần, để test.
 * - người chạy / admin: mọi trạng thái
 * - người đặt: chỉ huỷ, và chỉ khi đơn còn chờ chạy
 */
export function canSetOrderStatus(
  who: { username: string; isAdmin: boolean; runner: string | null },
  order: { requestedBy: string; status: string },
  next: AdOrderStatus,
): boolean {
  if (who.isAdmin || (who.runner && who.username === who.runner)) return true;
  return who.username === order.requestedBy && next === "huy" && order.status === "cho_chay";
}

const syncing = new Set<string>();

export function registerAdOrderRoutes(app: Express) {
  // Mọi trang đã nối Meta, kèm tên thương hiệu và tình trạng đọc quảng cáo.
  app.get("/api/fanpages/connected", requireAuth, async (_req, res) => {
    if (dbDown(res)) return;
    try {
      const rows = await getDb()
        .select({
          id: brandFanpages.id,
          brandId: brandFanpages.brandId,
          brandName: brands.name,
          pageName: brandFanpages.pageName,
          pictureUrl: brandFanpages.metaPictureUrl,
          metaPostsSyncedAt: brandFanpages.metaPostsSyncedAt,
          metaAdsStatus: brandFanpages.metaAdsStatus,
          metaAdsNote: brandFanpages.metaAdsNote,
          metaPageId: brandFanpages.metaPageId,
        })
        .from(brandFanpages)
        .innerJoin(brands, eq(brands.id, brandFanpages.brandId));
      res.json(rows.filter((r) => r.metaPageId).map(({ metaPageId: _omit, ...r }) => r));
    } catch (e: any) {
      console.error("fanpages connected:", e?.message || e);
      res.status(500).json({ error: "Không tải được danh sách trang." });
    }
  });

  // Danh mục bài của một trang. ?ads=1 chỉ lấy bài đang chạy quảng cáo.
  app.get("/api/fanpages/:fid/posts", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { fid } = req.params;
    if (!UUID_RE.test(fid)) return res.status(400).json({ error: "Mã trang không hợp lệ." });
    try {
      const db = getDb();
      const [fp] = await db.select().from(brandFanpages).where(eq(brandFanpages.id, fid));
      if (!fp) return res.status(404).json({ error: "Không tìm thấy trang." });
      const where =
        req.query.ads === "1"
          ? and(eq(fanpagePosts.fanpageId, fid), eq(fanpagePosts.adActive, true))
          : eq(fanpagePosts.fanpageId, fid);
      const posts = await db.select().from(fanpagePosts).where(where).orderBy(desc(fanpagePosts.createdTime)).limit(200);

      // Đơn còn mở của từng bài — để nút "Đặt chạy quảng cáo" biết đã có người đặt.
      const ids = posts.map((p) => p.postId);
      const orders = ids.length
        ? await db
            .select()
            .from(adOrders)
            .where(and(eq(adOrders.fanpageId, fid), inArray(adOrders.postId, ids), inArray(adOrders.status, ["cho_chay", "dang_chay"])))
        : [];
      const orderByPost = new Map(orders.map((o) => [o.postId, o]));

      // Bài đang chạy quảng cáo lên đầu, rồi tới bài mới nhất.
      const items = posts
        .map((p) => ({ ...p, openOrder: orderByPost.get(p.postId) || null }))
        .sort((a, b) => Number(b.adActive) - Number(a.adActive));

      res.json({
        fanpageId: fid,
        syncedAt: fp.metaPostsSyncedAt,
        adsStatus: fp.metaAdsStatus,
        adsNote: fp.metaAdsNote,
        activeCount: posts.filter((p) => p.adActive).length,
        items,
      });
    } catch (e: any) {
      console.error("fanpage posts:", e?.message || e);
      res.status(500).json({ error: "Không tải được bài của trang." });
    }
  });

  // Đồng bộ ngay — miễn phí (Graph), ai cũng bấm được; một trang không chạy chồng.
  app.post("/api/fanpages/:fid/posts/sync", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { fid } = req.params;
    if (!UUID_RE.test(fid)) return res.status(400).json({ error: "Mã trang không hợp lệ." });
    if (syncing.has(fid)) return res.status(409).json({ error: "Trang này đang được đồng bộ, chờ một chút." });
    syncing.add(fid);
    try {
      const { syncFanpageAds } = await import("../services/fanpage-ads-job");
      res.json(await syncFanpageAds(fid));
    } catch (e: any) {
      console.warn("fanpage posts sync:", e?.message || e);
      res.status(400).json({ error: e?.message || "Không đồng bộ được." });
    } finally {
      syncing.delete(fid);
    }
  });

  // ===== Đơn đặt quảng cáo =====

  app.get("/api/ad-orders/runner", requireAuth, async (_req, res) => {
    res.json({ runner: await adsRunner() });
  });

  app.put("/api/ad-orders/runner", requireAuth, requireAdmin, async (req, res) => {
    if (dbDown(res)) return;
    const username = String(req.body?.runner || "").trim();
    if (!username) return res.status(400).json({ error: "Chọn người chạy quảng cáo." });
    const [u] = await getDb().select().from(users).where(eq(users.username, username));
    if (!u || !u.isActive) return res.status(400).json({ error: "Không tìm thấy người dùng đang hoạt động này." });
    await setSetting(ADS_RUNNER_KEY, username, getAuthUser(req)!);
    // Đơn đang chờ mà chưa có người nhận thì giao luôn cho người mới.
    await getDb()
      .update(adOrders)
      .set({ assignee: username, updatedAt: new Date() })
      .where(and(eq(adOrders.status, "cho_chay")));
    res.json({ runner: username });
  });

  // Danh sách người dùng đang hoạt động — để admin chọn người chạy quảng cáo.
  app.get("/api/ad-orders/candidates", requireAuth, requireAdmin, async (_req, res) => {
    if (dbDown(res)) return;
    const rows = await getDb().select({ username: users.username, email: users.email, isActive: users.isActive }).from(users);
    res.json(rows.filter((r) => r.isActive).map(({ isActive: _x, ...r }) => r));
  });

  app.get("/api/ad-orders", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const username = getAuthUser(req)!;
    try {
      const status = String(req.query.status || "");
      const db = getDb();
      const rows = await db
        .select({ order: adOrders, pageName: brandFanpages.pageName, brandName: brands.name })
        .from(adOrders)
        .leftJoin(brandFanpages, eq(brandFanpages.id, adOrders.fanpageId))
        .leftJoin(brands, eq(brands.id, brandFanpages.brandId))
        .where(AD_ORDER_STATUSES.includes(status as AdOrderStatus) ? eq(adOrders.status, status) : undefined)
        .orderBy(desc(adOrders.createdAt))
        .limit(300);

      // Số liệu quảng cáo hiện tại của bài trong đơn.
      const postIds = rows.map((r) => r.order.postId);
      const posts = postIds.length
        ? await db.select().from(fanpagePosts).where(inArray(fanpagePosts.postId, postIds))
        : [];
      const postOf = new Map(posts.map((p) => [`${p.fanpageId}:${p.postId}`, p]));

      const runner = await adsRunner();
      const isAdmin = await isActiveAdmin(username);
      res.json({
        runner,
        me: username,
        canManage: isAdmin || username === runner,
        items: rows.map((r) => {
          const p = postOf.get(`${r.order.fanpageId}:${r.order.postId}`);
          return {
            ...r.order,
            pageName: r.pageName,
            brandName: r.brandName,
            ad: p
              ? {
                  active: p.adActive,
                  spend: p.adSpend,
                  currency: p.adCurrency,
                  impressions: p.adImpressions,
                  reach: p.adReach,
                  lastSeenAt: p.adLastSeenAt,
                }
              : null,
          };
        }),
      });
    } catch (e: any) {
      console.error("ad orders list:", e?.message || e);
      res.status(500).json({ error: "Không tải được đơn đặt quảng cáo." });
    }
  });

  app.post("/api/ad-orders", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const username = getAuthUser(req)!;
    const fanpageId = String(req.body?.fanpageId || "");
    const postId = String(req.body?.postId || "").trim();
    const note = String(req.body?.note || "").trim().slice(0, 1000) || null;
    if (!UUID_RE.test(fanpageId) || !postId) return res.status(400).json({ error: "Chọn bài cần chạy quảng cáo." });
    try {
      const db = getDb();
      const [post] = await db
        .select()
        .from(fanpagePosts)
        .where(and(eq(fanpagePosts.fanpageId, fanpageId), eq(fanpagePosts.postId, postId)));
      if (!post) return res.status(404).json({ error: "Không tìm thấy bài này trong danh mục của trang." });

      const [open] = await db
        .select()
        .from(adOrders)
        .where(and(eq(adOrders.fanpageId, fanpageId), eq(adOrders.postId, postId), inArray(adOrders.status, ["cho_chay", "dang_chay"])));
      if (open) {
        return res.status(409).json({ error: `Bài này đã được ${open.requestedBy} đặt chạy quảng cáo rồi.`, id: open.id });
      }

      const runner = await adsRunner();
      // Bài đã chạy quảng cáo sẵn thì đơn vào thẳng "đang chạy".
      const status: AdOrderStatus = post.adActive ? "dang_chay" : "cho_chay";
      const now = new Date();
      const [row] = await db
        .insert(adOrders)
        .values({
          fanpageId,
          postId,
          postMessage: post.message,
          postPermalink: post.permalink,
          postThumbnailUrl: post.thumbnailUrl,
          note,
          requestedBy: username,
          assignee: runner,
          status,
          statusBy: post.adActive ? "system" : username,
          startedAt: post.adActive ? now : null,
        })
        .returning();
      res.status(201).json({
        ...row,
        message: runner
          ? `Đã đặt — ${runner} sẽ nhận và set-up quảng cáo.`
          : "Đã đặt — chưa có người chạy quảng cáo, nhờ admin chọn người nhận đơn.",
      });
    } catch (e: any) {
      console.error("ad order create:", e?.message || e);
      res.status(500).json({ error: "Không đặt được." });
    }
  });

  app.patch("/api/ad-orders/:id", requireAuth, async (req, res) => {
    if (dbDown(res)) return;
    const { id } = req.params;
    if (!UUID_RE.test(id)) return res.status(400).json({ error: "Mã đơn không hợp lệ." });
    const username = getAuthUser(req)!;
    try {
      const db = getDb();
      const [order] = await db.select().from(adOrders).where(eq(adOrders.id, id));
      if (!order) return res.status(404).json({ error: "Không tìm thấy đơn." });

      const who = { username, isAdmin: await isActiveAdmin(username), runner: await adsRunner() };
      const patch: Record<string, any> = { updatedAt: new Date() };

      if (req.body?.status !== undefined) {
        const next = String(req.body.status) as AdOrderStatus;
        if (!AD_ORDER_STATUSES.includes(next)) return res.status(400).json({ error: "Trạng thái không hợp lệ." });
        if (!canSetOrderStatus(who, order, next)) {
          return res.status(403).json({ error: "Chỉ người chạy quảng cáo hoặc admin đổi được trạng thái đơn này." });
        }
        patch.status = next;
        patch.statusBy = username;
        if (next === "dang_chay" && !order.startedAt) patch.startedAt = new Date();
        if (next === "da_xong" || next === "huy") patch.endedAt = new Date();
        if (next === "cho_chay") {
          patch.startedAt = null;
          patch.endedAt = null;
        }
      }
      if (typeof req.body?.note === "string") {
        const mayEditNote = who.isAdmin || username === who.runner || username === order.requestedBy;
        if (!mayEditNote) return res.status(403).json({ error: "Không sửa được ghi chú của đơn này." });
        patch.note = req.body.note.trim().slice(0, 1000) || null;
      }

      const [row] = await db.update(adOrders).set(patch).where(eq(adOrders.id, id)).returning();
      res.json(row);
    } catch (e: any) {
      console.error("ad order patch:", e?.message || e);
      res.status(500).json({ error: "Không lưu được." });
    }
  });
}
