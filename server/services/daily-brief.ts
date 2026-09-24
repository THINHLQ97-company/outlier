// Toàn cảnh trong một lần gọi, dành cho phiên làm việc định kỳ của Claude.
//
// Vì sao cần: chạy định kỳ mà phải gọi bảy tám tool mới biết có gì mới thì vừa
// chậm vừa tốn, và dễ bỏ sót. Tool này trả về đủ thứ để quyết định NÊN LÀM GÌ
// TIẾP, kèm việc cụ thể chứ không chỉ số liệu.
//
// Cố ý KHÔNG tự quét gì ở đây: mở bản tóm tắt phải luôn miễn phí. Quét kênh tốn
// tiền nên chỉ chạy khi có người bấm — bản tóm tắt chỉ NÓI rằng nên quét.
import { and, desc, eq, gte } from "drizzle-orm";
import { getDb } from "../db/client";
import { brands, deconstructions, radarItems, remakes, signals, watchedChannels } from "../db/schema";

export interface DailyBrief {
  generatedAt: string;
  brands: { id: string; name: string; ready: boolean }[];
  /** Xu hướng mới trong 3 ngày, chưa xử lý. */
  freshTrends: { id: string; title: string; source: string; summary: string; url?: string | null }[];
  /** Bài hay đã quét, điểm cao, chưa đem đi bóc cấu trúc. */
  hotPosts: {
    id: string;
    title: string;
    url: string;
    score: number | null;
    channel?: string | null;
    why?: string;
  }[];
  /** Bản bóc đã xong nhưng chưa đọc bình luận — mỏ vàng còn bỏ ngỏ. */
  deconstructionsWithoutComments: { id: string; title: string; platform?: string | null }[];
  /** Bản viết xong mà chưa đăng. */
  unpublishedDrafts: { id: string; title: string; hasImage: boolean }[];
  /** Kênh lâu chưa quét lại. */
  staleChannels: { id: string; name: string; lastScanAt?: string | null }[];
  /** Việc nên làm tiếp, viết sẵn thành câu. */
  suggestedActions: string[];
}

const DAY = 24 * 60 * 60 * 1000;

function shorten(s: string | null | undefined, n = 160): string {
  const t = (s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
}

export async function buildDailyBrief(owner: string): Promise<DailyBrief> {
  const db = getDb();
  const now = Date.now();

  const brandRows = await db.select().from(brands);
  const brandList = brandRows.map((b) => ({
    id: b.id,
    name: b.name,
    // "Sẵn sàng" nghĩa là viết ra sẽ đúng giọng, không phải chỉ có tên.
    ready: !!(b.pageRole || b.personality || b.toneOfVoice),
  }));

  const freshCutoff = new Date(now - 3 * DAY);
  const trendRows = await db
    .select()
    .from(signals)
    .where(and(gte(signals.publishedDate, freshCutoff), eq(signals.status, "new")))
    .orderBy(desc(signals.publishedDate))
    .limit(15);

  const hotRows = await db
    .select()
    .from(radarItems)
    .orderBy(desc(radarItems.outperformScore))
    .limit(30);

  // Bài đã đem đi bóc rồi thì không gợi ý lại.
  const deconRows = await db.select().from(deconstructions).where(eq(deconstructions.owner, owner));
  const doneUrls = new Set(deconRows.map((d) => d.sourceUrl));

  const hotPosts = hotRows
    .filter((r) => !doneUrls.has(r.url))
    .slice(0, 10)
    .map((r) => ({
      id: r.id,
      title: shorten(r.title || r.url, 120),
      url: r.url,
      score: r.outperformScore,
      channel: r.channelName,
      why: (r.scoreBreakdown as any)?.reasons?.[0],
    }));

  const withoutComments = deconRows
    .filter((d) => d.status === "ready" && !d.audienceInsight)
    .slice(0, 10)
    .map((d) => ({ id: d.id, title: shorten(d.title || d.sourceUrl, 120), platform: d.platform }));

  const remakeRows = await db.select().from(remakes).where(eq(remakes.owner, owner));
  const unpublished = remakeRows
    .filter((r) => r.status === "ready" && !!r.draft?.trim() && (r.publishedJson || []).length === 0)
    .slice(0, 10)
    .map((r) => ({
      id: r.id,
      title: shorten(r.sourceTitle || r.draft, 100),
      hasImage: !!r.selectedImageUrl,
    }));

  const channelRows = await db.select().from(watchedChannels).where(eq(watchedChannels.owner, owner));
  const staleCutoff = now - 3 * DAY;
  const staleChannels = channelRows
    .filter((c) => !c.lastScanAt || new Date(c.lastScanAt).getTime() < staleCutoff)
    .slice(0, 10)
    .map((c) => ({
      id: c.id,
      name: c.channelName || c.channelUrl,
      lastScanAt: c.lastScanAt ? new Date(c.lastScanAt).toISOString() : null,
    }));

  // Việc nên làm: xếp theo thứ tự rẻ trước, tốn tiền sau — để phiên tự động
  // không mặc định đi vào chỗ tốn tiền.
  const actions: string[] = [];
  if (brandList.length === 0) {
    actions.push("Chưa có thương hiệu nào — tạo bằng brand_create rồi nạp hồ sơ, vì mọi thứ khác đều dựa vào đó.");
  } else if (!brandList.some((b) => b.ready)) {
    actions.push("Hồ sơ thương hiệu còn trống nên viết ra sẽ chung chung — xem brand_brief để biết thiếu gì.");
  }
  if (trendRows.length === 0) {
    actions.push("Chưa có xu hướng mới — chạy google_trends_scan (miễn phí), hoặc tự tìm tin nóng rồi signals_add.");
  } else {
    actions.push(`Có ${trendRows.length} xu hướng mới chưa xử lý — dùng trend_draft để ra phương án đăng được.`);
  }
  if (withoutComments.length > 0) {
    actions.push(
      `${withoutComments.length} bài đã bóc cấu trúc nhưng chưa đọc bình luận — deconstruct_comments cho biết người đọc thật sự quan tâm gì (YouTube miễn phí, Facebook/TikTok tốn tiền).`,
    );
  }
  if (unpublished.length > 0) {
    const noImage = unpublished.filter((r) => !r.hasImage).length;
    actions.push(
      `${unpublished.length} bản viết xong chưa đăng${noImage ? `, trong đó ${noImage} bài chưa có ảnh` : ""}.`,
    );
  }
  if (staleChannels.length > 0) {
    actions.push(
      `${staleChannels.length} kênh đã hơn 3 ngày chưa quét lại — channel_refresh TỐN TIỀN, hỏi người dùng trước.`,
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    brands: brandList,
    freshTrends: trendRows.map((t) => ({
      id: t.id,
      title: t.title,
      source: t.source,
      summary: shorten(t.rawSummary),
      url: t.sourceUrl,
    })),
    hotPosts,
    deconstructionsWithoutComments: withoutComments,
    unpublishedDrafts: unpublished,
    staleChannels,
    suggestedActions: actions,
  };
}
