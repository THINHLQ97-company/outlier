// Đổi một bài quét được thành dòng lưu trong radar_items.
//
// Tách ra khỏi route để CÓ THỂ TEST. Trước đây đoạn này nằm giữa một hàm dài,
// và nó thiếu hẳn hai cột `comments` và `shares` — bài quét về bao nhiêu bình
// luận cũng không được ghi. Không ai thấy, vì đường "Sửa số liệu cũ" lại ghi
// đúng hai cột đó: vá xong thì có, quét lại thì mất, lặp đi lặp lại.
//
// Một hàm thuần + test liệt kê từng cột là cách duy nhất để lỗi kiểu "quên một
// trường" không quay lại.
export interface ScanCandidate {
  platform: string;
  itemKey: string;
  url: string;
  title?: string | null;
  coverUrl?: string | null;
  durationSec?: number | null;
  publishedAt?: string | Date | null;
  channelKey?: string | null;
  channelName?: string | null;
  followerCount?: number | null;
  views?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  contentKind?: string;
  __fromApify?: boolean;
}

export interface RowContext {
  jobId: string;
  /** Số người theo dõi của kênh, dùng khi bài không kèm. */
  knownFollowers: number | null;
  isNew: boolean;
}

export function radarItemRow(c: ScanCandidate, ctx: RowContext) {
  return {
    jobId: ctx.jobId,
    platform: c.platform,
    itemKey: c.itemKey,
    url: c.url,
    title: c.title ?? null,
    coverUrl: c.coverUrl ?? null,
    durationSec: c.durationSec ?? null,
    publishedAt: c.publishedAt ? new Date(c.publishedAt) : null,
    channelKey: c.channelKey ?? null,
    channelName: c.channelName ?? null,
    followerCount: c.followerCount ?? ctx.knownFollowers,
    views: c.views ?? null,
    likes: c.likes ?? null,
    // Hai cột này từng bị bỏ quên — chúng là thứ nói lên mức độ CHẠM của bài,
    // quan trọng hơn cả lượt thích khi chấm bài đáng remake.
    comments: c.comments ?? null,
    shares: c.shares ?? null,
    contentKind: c.contentKind || "unknown",
    metricsSource: c.__fromApify ? "apify" : "scan",
    isNew: ctx.isNew,
  };
}
