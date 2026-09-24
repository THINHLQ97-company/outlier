// Lấy nội dung + chỉ số của MỘT BÀI cụ thể qua Apify.
//
// Phát hiện quan trọng (2026-09-22): cào cả TRANG Facebook thì không được —
// đã thử 5 actor, đều trả "not_available". Nhưng cào MỘT BÀI theo link cụ thể
// thì LẤY ĐƯỢC đầy đủ: nội dung chữ, lượt thích, bình luận, chia sẻ, ngày đăng,
// tên trang và ảnh đại diện bài.
//
// Đường này cũng cần cho TikTok: yt-dlp bản mới nhất (2026.08.19) đang lỗi
// "Unexpected response from webpage request" với mọi video TikTok, nên tải trực
// tiếp không còn chạy.
import { estimateCostUsd, isApifyConfigured } from "./apify";

const API_BASE = "https://api.apify.com/v2";
const RUN_TIMEOUT_MS = 240_000;

export type PostKind = "video" | "post" | "image" | "unknown";

export interface FetchedPost {
  url: string;
  kind: PostKind;
  text?: string;
  title?: string;
  thumbnailUrl?: string;
  /** Link video tải được (nếu có) — dùng để tách khung hình. */
  videoUrl?: string;

  likes?: number;
  comments?: number;
  shares?: number;
  views?: number;
  followerCount?: number;

  channelName?: string;
  channelKey?: string;
  publishedAt?: string;
  durationSec?: number;
}

export interface FetchOutcome {
  post?: FetchedPost;
  warning?: string;
  costUsd?: number;
}

function apiKey(): string {
  return (process.env.APIFY_TOKEN || "").trim();
}

export function detectPlatform(url: string): string | null {
  const u = url.toLowerCase();
  if (u.includes("facebook.com") || u.includes("fb.com") || u.includes("fb.watch")) return "facebook";
  if (u.includes("tiktok.com")) return "tiktok";
  if (u.includes("instagram.com")) return "instagram";
  if (u.includes("youtube.com") || u.includes("youtu.be")) return "youtube";
  if (u.includes("douyin.com")) return "douyin";
  return null;
}

/** Actor lấy MỘT BÀI theo link, theo nền tảng. */
function actorForPost(platform: string): string | null {
  const map: Record<string, string> = {
    facebook: process.env.APIFY_ACTOR_FB_POST || "apify~facebook-posts-scraper",
    tiktok: process.env.APIFY_ACTOR_TIKTOK || "clockworks~tiktok-scraper",
    instagram: process.env.APIFY_ACTOR_INSTAGRAM || "apify~instagram-scraper",
  };
  return map[platform] || null;
}

function inputForPost(platform: string, url: string): Record<string, any> {
  if (platform === "facebook") return { startUrls: [{ url }], resultsLimit: 1 };
  if (platform === "tiktok") {
    return { postURLs: [url], resultsPerPage: 1, shouldDownloadVideos: false, shouldDownloadCovers: true, shouldDownloadSubtitles: false };
  }
  return { directUrls: [url], resultsLimit: 1, addParentData: false };
}

function num(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Quy về một dạng chung. Tên trường khác nhau hẳn giữa các actor. */
function normalizePost(raw: any, platform: string, url: string): FetchedPost | null {
  if (!raw || raw.error) return null;

  // Facebook: text/likes/comments/shares/time/user/media[].thumbnail
  if (platform === "facebook") {
    const media = Array.isArray(raw.media) ? raw.media[0] : undefined;
    const hasVideo = !!(media?.__typename === "Video" || media?.video_url || raw.videoUrl);
    return {
      url: raw.url || raw.topLevelUrl || url,
      kind: hasVideo ? "video" : media ? "image" : "post",
      text: typeof raw.text === "string" ? raw.text : undefined,
      thumbnailUrl: media?.thumbnail || media?.photo_image?.uri || raw.thumbnailUrl || undefined,
      videoUrl: media?.video_url || raw.videoUrl || undefined,
      likes: num(raw.likes) ?? num(raw.reactionsCount),
      comments: num(raw.comments),
      shares: num(raw.shares),
      channelName: raw.user?.name || raw.pageName || undefined,
      channelKey: raw.user?.id ? String(raw.user.id) : undefined,
      publishedAt: raw.time || (raw.timestamp ? new Date(Number(raw.timestamp) * 1000).toISOString() : undefined),
    };
  }

  // TikTok (clockworks)
  if (platform === "tiktok") {
    const a = raw.authorMeta || {};
    return {
      url: raw.webVideoUrl || url,
      kind: "video",
      text: raw.text || undefined,
      thumbnailUrl: raw.covers?.default || raw.videoMeta?.coverUrl || raw.covers?.[0] || undefined,
      videoUrl: raw.videoMeta?.downloadAddr || undefined,
      views: num(raw.playCount), likes: num(raw.diggCount),
      comments: num(raw.commentCount), shares: num(raw.shareCount),
      followerCount: num(a.fans),
      channelName: a.nickName || a.name || undefined,
      channelKey: a.id ? String(a.id) : undefined,
      publishedAt: raw.createTimeISO || undefined,
      durationSec: num(raw.videoMeta?.duration),
    };
  }

  // Instagram
  return {
    url: raw.url || url,
    kind: raw.type === "Video" ? "video" : raw.type === "Image" ? "image" : "post",
    text: raw.caption || undefined,
    thumbnailUrl: raw.displayUrl || raw.thumbnailUrl || undefined,
    videoUrl: raw.videoUrl || undefined,
    views: num(raw.videoViewCount) ?? num(raw.videoPlayCount),
    likes: num(raw.likesCount), comments: num(raw.commentsCount),
    followerCount: num(raw.ownerFollowersCount),
    channelName: raw.ownerUsername || undefined,
    publishedAt: raw.timestamp || undefined,
    durationSec: num(raw.videoDuration),
  };
}

/**
 * Lấy một bài theo link. TỐN TIỀN (khoảng một kết quả Apify).
 * Nơi gọi phải hỏi người dùng trước.
 */
export async function fetchPostViaApify(url: string): Promise<FetchOutcome> {
  const platform = detectPlatform(url);
  if (!platform) return { warning: "Không nhận ra bài này thuộc nền tảng nào." };
  if (platform === "douyin") return { warning: "Douyin cần bộ quét riêng, chưa nối trong bản này." };
  if (platform === "youtube") return { warning: "YouTube tải trực tiếp được, không cần dùng dịch vụ có phí." };
  if (!isApifyConfigured()) return { warning: "Chưa cấu hình dịch vụ lấy bài (APIFY_TOKEN)." };

  const actor = actorForPost(platform);
  if (!actor) return { warning: `Chưa hỗ trợ lấy bài lẻ từ ${platform}.` };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), RUN_TIMEOUT_MS);
  try {
    // Trần tiền cứng do Apify áp phía họ — chặn được cả khi code mình tính sai
    // số kết quả (xem maxChargePerRunUsd trong apify.ts).
    const { maxChargePerRunUsd } = await import("./apify");
    const runUrl =
      `${API_BASE}/acts/${encodeURIComponent(actor)}/run-sync-get-dataset-items` +
      `?maxTotalChargeUsd=${maxChargePerRunUsd()}`;
    const res = await fetch(runUrl, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey()}` },
      body: JSON.stringify(inputForPost(platform, url)),
    });
    const body = await res.text();
    if (!res.ok) return { warning: `Không lấy được bài (${res.status}): ${body.slice(0, 160)}` };

    let data: any;
    try { data = JSON.parse(body); } catch { return { warning: "Phản hồi không đọc được." }; }
    const arr = Array.isArray(data) ? data : [data];

    // Ghi sổ: trước đây đường này không ghi gì nên con số "đã dùng hôm nay"
    // luôn thấp hơn thực tế — mà đó là con số dùng để quyết định có chặn hay không.
    const { recordUsage } = await import("./cost-tracker");
    await recordUsage({ actorId: actor, itemCount: arr.length, kind: "post", note: `bài lẻ ${platform}` });
    if (arr.length === 0) return { warning: "Không lấy được nội dung bài này." };

    const first = arr[0];
    if (first?.error) {
      return { warning: String(first.errorDescription || first.error).slice(0, 200) };
    }
    const post = normalizePost(first, platform, url);
    if (!post) return { warning: "Bài này không đọc được nội dung." };

    return { post, costUsd: estimateCostUsd(1) };
  } catch (e: any) {
    return { warning: `Không lấy được bài: ${e?.message || e}` };
  } finally {
    clearTimeout(timer);
  }
}
