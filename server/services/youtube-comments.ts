// Đọc bình luận YouTube bằng Data API v3.
//
// YouTube khác hẳn Facebook ở điểm này: chỉ cần một API key miễn phí là đọc được
// bình luận của video BẤT KỲ, không cần sở hữu kênh, không qua dịch vụ trả tiền.
// Hạn mức mặc định 10.000 đơn vị/ngày; mỗi lượt đọc bình luận tốn 1 đơn vị, tức
// khoảng 10.000 lượt mỗi ngày — thực tế là không giới hạn với nhu cầu ở đây.
//
// Không có key thì nói rõ, không âm thầm rơi sang Apify: người dùng cần biết
// mình đang sắp tốn tiền cho thứ vốn miễn phí.
const API_BASE = "https://www.googleapis.com/youtube/v3";
const TIMEOUT_MS = 20_000;

export interface YouTubeComment {
  text: string;
  likes?: number;
  author?: string;
}

function apiKey(): string | null {
  const k = (process.env.YOUTUBE_API_KEY || "").trim();
  return k || null;
}

/** Lấy mã video từ mọi dạng link YouTube hay gặp. */
export function videoIdFromUrl(url: string): string | null {
  const patterns = [
    /[?&]v=([A-Za-z0-9_-]{11})/,
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/embed\/([A-Za-z0-9_-]{11})/,
  ];
  for (const re of patterns) {
    const m = re.exec(url);
    if (m) return m[1];
  }
  return null;
}

export interface YouTubeCommentResult {
  comments: YouTubeComment[];
  warning?: string;
}

export async function fetchYouTubeComments(url: string, limit = 100): Promise<YouTubeCommentResult> {
  const key = apiKey();
  if (!key) {
    return {
      comments: [],
      warning:
        "Chưa có YOUTUBE_API_KEY. YouTube cho đọc bình luận MIỄN PHÍ bằng API key — " +
        "lấy ở Google Cloud Console (bật YouTube Data API v3) rồi đặt vào biến môi trường.",
    };
  }

  const videoId = videoIdFromUrl(url);
  if (!videoId) return { comments: [], warning: "Không nhận ra mã video trong đường dẫn này." };

  const out: YouTubeComment[] = [];
  let pageToken: string | undefined;

  // Mỗi trang tối đa 100; lật tối đa 5 trang để không đi hoang.
  for (let page = 0; page < 5 && out.length < limit; page++) {
    const params = new URLSearchParams({
      part: "snippet",
      videoId,
      maxResults: String(Math.min(100, limit - out.length)),
      // Bình luận được thích nhiều nói lên mối quan tâm chung rõ hơn bình luận mới nhất.
      order: "relevance",
      textFormat: "plainText",
      key,
    });
    if (pageToken) params.set("pageToken", pageToken);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${API_BASE}/commentThreads?${params}`, { signal: ctrl.signal });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const reason = body?.error?.errors?.[0]?.reason;
        // Hai lỗi này người dùng sửa được, nên nói đúng tên vấn đề.
        if (reason === "commentsDisabled") return { comments: out, warning: "Video này đã tắt bình luận." };
        if (reason === "quotaExceeded") {
          return { comments: out, warning: "Hết hạn mức YouTube API hôm nay — thử lại ngày mai." };
        }
        return { comments: out, warning: `YouTube API lỗi: ${body?.error?.message || res.statusText}` };
      }

      for (const item of body.items || []) {
        const sn = item?.snippet?.topLevelComment?.snippet;
        const text = String(sn?.textDisplay || "").trim();
        if (!text) continue;
        out.push({
          text,
          likes: Number(sn?.likeCount) || undefined,
          author: sn?.authorDisplayName || undefined,
        });
      }

      pageToken = body.nextPageToken;
      if (!pageToken) break;
    } catch (e: any) {
      if (e?.name === "AbortError") return { comments: out, warning: "Quá lâu không phản hồi." };
      return { comments: out, warning: e?.message || "Lỗi khi gọi YouTube API." };
    } finally {
      clearTimeout(timer);
    }
  }

  return { comments: out.slice(0, limit) };
}
