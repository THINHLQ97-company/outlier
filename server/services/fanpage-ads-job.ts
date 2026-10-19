// Mỗi giờ: đồng bộ bài của trang nhà + đánh dấu bài đang chạy quảng cáo, rồi
// tự chuyển trạng thái đơn đặt quảng cáo (task #6843).
//
// Miễn phí (Graph API), nên chạy mỗi giờ được — khác quét kênh đối thủ (Apify).
// Không ném lỗi ra ngoài: một trang hỏng không làm dừng trang khác.
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { getDb, isDbConfigured } from "../db/client";
import { adOrders, brandFanpages, fanpagePosts } from "../db/schema";
import { decryptToken } from "./meta-token";
import { fetchPagePosts, fetchPost, type MetaPost } from "./meta-graph";
import { autoOrderStatus, fetchActiveAdsForPage, MetaAdsError, type AdsStatus, type StoryAds } from "./fanpage-ads";

const EVERY_MS = 60 * 60_000;
const FIRST_RUN_DELAY_MS = 90_000;
/** Số bài gần nhất giữ trong danh mục mỗi lượt. Bài cũ hơn đang chạy QC vẫn được lấy riêng. */
const RECENT_POSTS = 50;

export interface FanpageAdsSyncResult {
  fanpageId: string;
  posts: number;
  adsStatus: AdsStatus;
  activePosts: number;
  note?: string;
  ordersChanged: number;
}

async function upsertPosts(fanpageId: string, posts: MetaPost[]) {
  const db = getDb();
  const now = new Date();
  for (const p of posts) {
    const values = {
      message: p.message || null,
      permalink: p.permalink || null,
      thumbnailUrl: p.thumbnailUrl || null,
      mediaType: p.mediaType,
      createdTime: p.createdTime ? new Date(p.createdTime) : null,
      likes: p.likes,
      comments: p.comments,
      shares: p.shares,
      syncedAt: now,
    };
    await db
      .insert(fanpagePosts)
      .values({ fanpageId, postId: p.id, ...values })
      .onConflictDoUpdate({ target: [fanpagePosts.fanpageId, fanpagePosts.postId], set: values });
  }
}

/** Ghi tình trạng quảng cáo xuống từng bài của trang. */
async function applyAds(fanpageId: string, byStory: Map<string, StoryAds>, now: Date) {
  const db = getDb();
  const rows = await db.select().from(fanpagePosts).where(eq(fanpagePosts.fanpageId, fanpageId));
  for (const r of rows) {
    const ad = byStory.get(r.postId);
    if (ad) {
      await db
        .update(fanpagePosts)
        .set({
          adActive: true,
          adCount: ad.adIds.length,
          adIds: ad.adIds,
          adSpend: ad.spend,
          adImpressions: ad.impressions,
          adReach: ad.reach,
          adCurrency: ad.currency,
          adFirstSeenAt: r.adFirstSeenAt ?? now,
          adLastSeenAt: now,
        })
        .where(eq(fanpagePosts.id, r.id));
    } else if (r.adActive) {
      // Quảng cáo đã tắt: giữ số liệu cũ (chi tiêu trọn đời vẫn đúng), chỉ hạ cờ.
      await db.update(fanpagePosts).set({ adActive: false, adCount: 0 }).where(eq(fanpagePosts.id, r.id));
    }
  }
}

/** Đơn đặt quảng cáo của trang tự sang "đang chạy" / "đã xong" theo quảng cáo thật. */
async function applyOrders(fanpageId: string, byStory: Map<string, StoryAds>, now: Date): Promise<number> {
  const db = getDb();
  const open = await db
    .select()
    .from(adOrders)
    .where(and(eq(adOrders.fanpageId, fanpageId), inArray(adOrders.status, ["cho_chay", "dang_chay"])));
  if (open.length === 0) return 0;

  const postRows = await db
    .select({ postId: fanpagePosts.postId, adLastSeenAt: fanpagePosts.adLastSeenAt })
    .from(fanpagePosts)
    .where(and(eq(fanpagePosts.fanpageId, fanpageId), inArray(fanpagePosts.postId, open.map((o) => o.postId))));
  const lastSeen = new Map(postRows.map((p) => [p.postId, p.adLastSeenAt]));

  let changed = 0;
  for (const o of open) {
    const running = byStory.has(o.postId);
    const seen = lastSeen.get(o.postId);
    const seenSinceStart = !!(seen && o.startedAt && seen.getTime() >= o.startedAt.getTime());
    const next = autoOrderStatus(o.status, running, seenSinceStart);
    if (!next) continue;
    await db
      .update(adOrders)
      .set({
        status: next,
        statusBy: "system",
        updatedAt: now,
        ...(next === "dang_chay" ? { startedAt: now } : {}),
        ...(next === "da_xong" ? { endedAt: now } : {}),
      })
      .where(eq(adOrders.id, o.id));
    changed++;
  }
  return changed;
}

export async function syncFanpageAds(fanpageId: string): Promise<FanpageAdsSyncResult> {
  const db = getDb();
  const [fp] = await db.select().from(brandFanpages).where(eq(brandFanpages.id, fanpageId));
  if (!fp?.metaPageId || !fp.metaTokenEnc) throw new Error("Trang chưa nối Meta.");

  const pageToken = decryptToken(fp.metaTokenEnc);
  const now = new Date();

  // 1. Danh mục bài gần nhất (page token, miễn phí).
  const recent = await fetchPagePosts(fp.metaPageId, pageToken, RECENT_POSTS, { includeEmpty: true });
  await upsertPosts(fanpageId, recent);

  // 2. Quảng cáo đang chạy (user token + ads_read).
  let adsStatus: AdsStatus = "ok";
  let note: string | undefined;
  let byStory: Map<string, StoryAds> | null = null;
  if (!fp.metaUserTokenEnc) {
    adsStatus = "no_user_token";
    note =
      "Trang được nối bằng page token nên không đọc được tài khoản quảng cáo. Nối lại bằng user token có quyền ads_read.";
  } else {
    try {
      const out = await fetchActiveAdsForPage(fp.metaPageId, decryptToken(fp.metaUserTokenEnc));
      byStory = out.byStory;
      if (out.unmatched > 0) {
        note = `${out.unmatched} quảng cáo trong tài khoản không đẩy bài có sẵn (bài chỉ để chạy quảng cáo) — không gắn được vào bài nào.`;
      }
    } catch (e: any) {
      adsStatus = e instanceof MetaAdsError ? e.status : "error";
      note = e?.message || String(e);
    }
  }

  let ordersChanged = 0;
  if (byStory) {
    // Bài cũ ngoài 50 bài gần nhất mà đang chạy quảng cáo — lấy riêng để có trong danh mục.
    const known = new Set(recent.map((p) => p.id));
    const missing = [...byStory.keys()].filter((id) => !known.has(id));
    if (missing.length) {
      const existing = await db
        .select({ postId: fanpagePosts.postId })
        .from(fanpagePosts)
        .where(and(eq(fanpagePosts.fanpageId, fanpageId), inArray(fanpagePosts.postId, missing)));
      const have = new Set(existing.map((r) => r.postId));
      const extra: MetaPost[] = [];
      for (const id of missing.filter((m) => !have.has(m)).slice(0, 30)) {
        try {
          extra.push(await fetchPost(id, pageToken));
        } catch (e: any) {
          console.warn(`[fanpage-ads] Không đọc được bài ${id}: ${e?.message || e}`);
        }
      }
      await upsertPosts(fanpageId, extra);
    }
    await applyAds(fanpageId, byStory, now);
    // Chỉ đổi đơn khi đọc quảng cáo THÀNH CÔNG — đọc lỗi không có nghĩa là quảng cáo đã tắt.
    ordersChanged = await applyOrders(fanpageId, byStory, now);
  }

  await db
    .update(brandFanpages)
    .set({ metaPostsSyncedAt: now, metaAdsStatus: adsStatus, metaAdsNote: note ?? null })
    .where(eq(brandFanpages.id, fanpageId));

  return { fanpageId, posts: recent.length, adsStatus, activePosts: byStory?.size ?? 0, note, ordersChanged };
}

let running = false;

export async function sweepFanpageAds(reason: string): Promise<FanpageAdsSyncResult[]> {
  if (!isDbConfigured() || running) return [];
  running = true;
  const out: FanpageAdsSyncResult[] = [];
  try {
    const pages = await getDb()
      .select({ id: brandFanpages.id, name: brandFanpages.pageName })
      .from(brandFanpages)
      .where(and(isNotNull(brandFanpages.metaPageId), isNotNull(brandFanpages.metaTokenEnc)));
    for (const p of pages) {
      try {
        const r = await syncFanpageAds(p.id);
        out.push(r);
        console.log(
          `[fanpage-ads] ${reason} · ${p.name || p.id}: ${r.posts} bài, ${r.activePosts} bài đang chạy QC, quảng cáo=${r.adsStatus}` +
            (r.ordersChanged ? `, ${r.ordersChanged} đơn đổi trạng thái` : "") +
            (r.adsStatus !== "ok" && r.note ? ` — ${r.note}` : ""),
        );
      } catch (e: any) {
        console.warn(`[fanpage-ads] ${p.name || p.id}: ${e?.message || e}`);
        await getDb()
          .update(brandFanpages)
          .set({ metaAdsStatus: "error", metaAdsNote: String(e?.message || e).slice(0, 300) })
          .where(eq(brandFanpages.id, p.id))
          .catch(() => {});
      }
    }
  } finally {
    running = false;
  }
  return out;
}

let timer: NodeJS.Timeout | null = null;

export function startFanpageAdsJob(): void {
  if (timer || !isDbConfigured()) return;
  if (/^(off|false|0)$/i.test((process.env.FANPAGE_ADS_SYNC || "").trim())) return;
  setTimeout(() => void sweepFanpageAds("lượt đầu sau khởi động"), FIRST_RUN_DELAY_MS).unref?.();
  timer = setInterval(() => void sweepFanpageAds("lượt mỗi giờ"), EVERY_MS);
  timer.unref?.();
  console.log("[fanpage-ads] Đã bật đồng bộ bài + quảng cáo trang nhà mỗi 1 giờ.");
}
