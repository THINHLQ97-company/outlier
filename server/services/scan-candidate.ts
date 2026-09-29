// Đổi kết quả Apify (ApifyMetrics) thành "bài ứng viên" để lưu.
//
// Tách ra khỏi route vì đây là chỗ ĐÃ LÀM MẤT DỮ LIỆU hai lần liên tiếp: bảng
// ánh xạ viết tay, thiếu một trường thì không ai thấy — số liệu biến mất im
// lặng, và người dùng chỉ thấy dấu "—" mà không hiểu vì sao.
//
// Lần một: câu lệnh lưu thiếu cột comments/shares.
// Lần hai (chính chỗ này): bảng ánh xạ chỉ chép views và likes, nên comments
// bị vứt TRƯỚC KHI tới chỗ lưu — sửa chỗ lưu xong vẫn không có gì.
//
// Nên giờ: một hàm thuần + test đi qua TỪNG chỉ số. Thêm chỉ số mới mà quên
// chép là test đỏ ngay.
import type { ApifyMetrics } from "./apify";

export interface ScanCandidate {
  platform: string;
  itemKey: string;
  url: string;
  title?: string;
  coverUrl?: string;
  durationSec?: number;
  contentKind: string;
  publishedAt?: string;
  channelKey?: string;
  channelName?: string;
  channelAvatarUrl?: string;
  followerCount?: number | null;
  views?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  __fromApify: boolean;
}

/** Mọi chỉ số phải đi qua đây — danh sách này là hợp đồng, test canh đúng nó. */
export const METRIC_FIELDS = ["views", "likes", "comments", "shares", "followerCount"] as const;

export function toScanCandidate(platform: string, m: ApifyMetrics): ScanCandidate {
  return {
    platform,
    itemKey: m.itemKey,
    url: m.url,
    title: m.title,
    coverUrl: m.coverUrl,
    durationSec: undefined,
    // Facebook là bài viết (chữ + ảnh); TikTok/Instagram/YouTube là video.
    contentKind: platform === "facebook" ? "post" : "video",
    publishedAt: m.publishedAt,
    channelKey: m.channelKey,
    channelName: m.channelName,
    channelAvatarUrl: m.channelAvatarUrl,
    followerCount: m.followerCount,
    views: m.views,
    likes: m.likes,
    // Hai dòng dưới đây là thứ đã bị bỏ quên. Số bình luận và chia sẻ nói lên
    // mức độ CHẠM của bài — quan trọng hơn lượt thích khi chấm bài đáng remake.
    comments: m.comments,
    shares: m.shares,
    __fromApify: true,
  };
}
