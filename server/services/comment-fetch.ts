// Lấy bình luận của một bài đã đăng.
//
// Vì sao tách khỏi post-fetch: lấy bài và lấy bình luận là hai actor khác nhau,
// giá khác nhau, và bình luận là thứ TỐN NHIỀU HƠN vì mỗi bình luận tính một
// kết quả. Một bài có 500 bình luận tốn gấp hàng trăm lần lấy chính bài đó.
//
// CÁI BẪY ĐẮT NHẤT (học từ share-projects/social, họ mất gần 1 đô một lượt):
// trường giới hạn số bình luận tên là `resultsLimit`, KHÔNG phải `maxComments`.
// Gõ sai tên thì actor không báo lỗi — nó lặng lẽ bỏ qua và trả về bao nhiêu tuỳ
// nó. Xin 50 nhận về 476. Vì vậy ở đây có hai lớp chặn: `resultsLimit` gửi cho
// actor, và `maxTotalChargeUsd` do Apify tự áp phía họ.
import { maxChargePerRunUsd, USD_PER_RESULT } from "./apify";

const API_BASE = "https://api.apify.com/v2";
const RUN_TIMEOUT_MS = 180_000;

/** Mỗi nền tảng một actor. Chỉ nền tảng nào có tên ở đây mới lấy được. */
const ACTOR_BY_PLATFORM: Record<string, string> = {
  facebook: "apify~facebook-comments-scraper",
  tiktok: "clockworks~tiktok-comments-scraper",
  // YouTube cố ý không dùng Apify: Data API v3 đọc bình luận miễn phí bằng API
  // key. Xem youtube-comments.ts.
};

export interface FetchedComment {
  text: string;
  likes?: number;
  author?: string;
}

export interface CommentFetchResult {
  comments: FetchedComment[];
  costUsd: number;
  warning?: string;
}

function apifyToken(): string {
  const t = (process.env.APIFY_TOKEN || "").trim();
  if (!t) throw new Error("APIFY_TOKEN chưa cấu hình — không lấy được bình luận.");
  return t;
}

function normalize(rows: any[]): FetchedComment[] {
  const out: FetchedComment[] = [];
  for (const r of rows) {
    // Mỗi actor đặt tên trường một kiểu; nhận hết các tên hay gặp.
    const text = String(r?.text ?? r?.message ?? r?.comment ?? r?.commentText ?? "").trim();
    if (!text) continue;
    out.push({
      text,
      likes: Number(r?.likesCount ?? r?.likes ?? r?.diggCount ?? 0) || undefined,
      author: String(r?.profileName ?? r?.author ?? r?.uniqueId ?? r?.ownerUsername ?? "").trim() || undefined,
    });
  }
  return out;
}

/**
 * Lấy tối đa `limit` bình luận của một bài.
 *
 * `limit` là trần thật, không phải gợi ý: nó vừa đi vào `resultsLimit` của actor,
 * vừa được dùng để cắt lại kết quả sau khi nhận — phòng trường hợp actor vẫn trả
 * về nhiều hơn.
 */
export async function fetchComments(
  platform: string,
  url: string,
  limit = 100,
): Promise<CommentFetchResult> {
  const actor = ACTOR_BY_PLATFORM[platform];
  if (!actor) {
    return { comments: [], costUsd: 0, warning: `Chưa hỗ trợ lấy bình luận từ ${platform}.` };
  }

  const safeLimit = Math.min(300, Math.max(10, limit));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), RUN_TIMEOUT_MS);
  try {
    const runUrl =
      `${API_BASE}/acts/${encodeURIComponent(actor)}/run-sync-get-dataset-items` +
      `?maxTotalChargeUsd=${maxChargePerRunUsd()}`;
    const res = await fetch(runUrl, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apifyToken()}` },
      body: JSON.stringify({
        startUrls: [{ url }],
        // TÊN TRƯỜNG NÀY PHẢI ĐÚNG — xem ghi chú đầu tệp.
        resultsLimit: safeLimit,
        includeNestedComments: false,
        viewOption: "RANKED_THREADED",
      }),
    });

    const body = await res.text();
    if (!res.ok) {
      return { comments: [], costUsd: 0, warning: `Không lấy được bình luận (${res.status}): ${body.slice(0, 160)}` };
    }

    let data: any;
    try {
      data = JSON.parse(body);
    } catch {
      return { comments: [], costUsd: 0, warning: "Phản hồi không đọc được." };
    }

    const rows = Array.isArray(data) ? data : [data];
    const all = normalize(rows);
    // Cắt lại một lần nữa: actor có thể trả nhiều hơn số đã xin.
    const comments = all.slice(0, safeLimit);

    return {
      comments,
      // Tính theo số THỰC NHẬN, không theo số đã xin — Apify tính tiền theo cái đã trả về.
      costUsd: Math.round(all.length * USD_PER_RESULT * 10000) / 10000,
      warning:
        all.length > safeLimit
          ? `Actor trả về ${all.length} bình luận dù chỉ xin ${safeLimit} — đã cắt bớt, nhưng tiền vẫn tính theo số thực nhận.`
          : undefined,
    };
  } catch (e: any) {
    if (e?.name === "AbortError") return { comments: [], costUsd: 0, warning: "Quá lâu không phản hồi." };
    return { comments: [], costUsd: 0, warning: e?.message || "Lỗi khi lấy bình luận." };
  } finally {
    clearTimeout(timer);
  }
}

/** Ước tính trước khi chạy, để hỏi người dùng có đồng ý tốn tiền không. */
export function estimateCommentCostUsd(limit: number): number {
  return Math.round(Math.min(300, Math.max(10, limit)) * USD_PER_RESULT * 10000) / 10000;
}

export function supportsComments(platform: string): boolean {
  return platform in ACTOR_BY_PLATFORM || platform === "youtube";
}
