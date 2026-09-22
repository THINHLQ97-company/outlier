// Rút số liệu từ các bài đã quét của một fanpage.
//
// Vì sao không chỉ đếm tổng like: con số tuyệt đối nói lên rất ít. Một page
// 200 nghìn theo dõi có bài 500 like là bài chết; page 2 nghìn theo dõi có bài
// 500 like là bài nổ. Thứ dùng được là bài đó hơn CHÍNH PAGE ĐÓ bao nhiêu lần —
// cùng một cách nghĩ với điểm vượt trội của Radar (xem outperform.ts).
//
// Dùng trung vị chứ không dùng trung bình: một bài viral kéo trung bình lên,
// làm mọi bài khác trông như thất bại.
import type { MetaPost } from "./meta-graph";

export interface FanpageStats {
  postCount: number;
  /** Khoảng thời gian các bài này trải ra, tính bằng ngày. */
  spanDays: number;
  postsPerWeek: number;

  /** Trung vị của chính page — mốc để biết thế nào là "hơn bình thường". */
  medianLikes: number;
  medianComments: number;
  medianShares: number;
  medianLength: number;

  /** Tỉ lệ từng định dạng, vd { video: 0.4, photo: 0.5, text: 0.1 }. */
  formatMix: Record<string, number>;
  /** Giờ trong ngày hay đăng nhất (0-23), theo giờ Việt Nam. */
  topHours: { hour: number; count: number }[];

  /** Bài vượt trội so với chính page này. */
  topPosts: FanpageTopPost[];
}

export interface FanpageTopPost {
  id: string;
  message: string;
  permalink?: string;
  thumbnailUrl?: string;
  createdTime: string;
  likes: number;
  comments: number;
  shares: number;
  mediaType: string;
  /** Gấp mấy lần bài trung vị của chính page. 2.4 = hơn bình thường 2,4 lần. */
  outperformRatio: number;
}

export function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Tương tác quy về một số: bình luận và chia sẻ tốn công hơn nên nặng ký hơn. */
export function engagement(p: { likes: number; comments: number; shares: number }): number {
  return p.likes + p.comments * 3 + p.shares * 5;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function summarizePosts(posts: MetaPost[]): FanpageStats {
  const empty: FanpageStats = {
    postCount: 0, spanDays: 0, postsPerWeek: 0,
    medianLikes: 0, medianComments: 0, medianShares: 0, medianLength: 0,
    formatMix: {}, topHours: [], topPosts: [],
  };
  if (posts.length === 0) return empty;

  const times = posts.map((p) => new Date(p.createdTime).getTime()).filter((t) => Number.isFinite(t));
  const spanDays =
    times.length >= 2 ? Math.max(1, Math.round((Math.max(...times) - Math.min(...times)) / 86_400_000)) : 1;

  const medianLikes = median(posts.map((p) => p.likes));
  const medianComments = median(posts.map((p) => p.comments));
  const medianShares = median(posts.map((p) => p.shares));
  const medianEngagement = median(posts.map(engagement));

  const formatCount: Record<string, number> = {};
  for (const p of posts) formatCount[p.mediaType] = (formatCount[p.mediaType] || 0) + 1;
  const formatMix: Record<string, number> = {};
  for (const [k, v] of Object.entries(formatCount)) formatMix[k] = round2(v / posts.length);

  // Giờ Việt Nam: Graph trả về giờ UTC, mà "đăng lúc mấy giờ" chỉ có nghĩa khi
  // quy về múi giờ người đọc.
  const hourCount: Record<number, number> = {};
  for (const p of posts) {
    const t = new Date(p.createdTime);
    if (!Number.isFinite(t.getTime())) continue;
    const hour = (t.getUTCHours() + 7) % 24;
    hourCount[hour] = (hourCount[hour] || 0) + 1;
  }
  const topHours = Object.entries(hourCount)
    .map(([hour, count]) => ({ hour: Number(hour), count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  const topPosts: FanpageTopPost[] = [...posts]
    .sort((a, b) => engagement(b) - engagement(a))
    .slice(0, 8)
    .map((p) => ({
      id: p.id,
      // Cắt bớt: đây là để nhận ra bài nào, không phải để đọc lại cả bài.
      message: p.message.length > 400 ? `${p.message.slice(0, 400)}…` : p.message,
      permalink: p.permalink,
      thumbnailUrl: p.thumbnailUrl,
      createdTime: p.createdTime,
      likes: p.likes,
      comments: p.comments,
      shares: p.shares,
      mediaType: p.mediaType,
      // Trung vị bằng 0 (page mới, chưa ai tương tác) thì tỉ lệ vô nghĩa — trả 0
      // thay vì chia cho 0 rồi ra Infinity.
      outperformRatio: medianEngagement > 0 ? round2(engagement(p) / medianEngagement) : 0,
    }));

  return {
    postCount: posts.length,
    spanDays,
    postsPerWeek: round2((posts.length / spanDays) * 7),
    medianLikes,
    medianComments,
    medianShares,
    medianLength: Math.round(median(posts.map((p) => p.message.length))),
    formatMix,
    topHours,
    topPosts,
  };
}

const FORMAT_LABEL: Record<string, string> = {
  text: "chỉ chữ",
  photo: "ảnh",
  video: "video",
  link: "chia sẻ link",
  other: "khác",
};

/**
 * Viết số liệu thành mấy dòng để nhét vào hồ sơ cho model đọc.
 * Có phần này thì việc remake bám vào thực tế của page, thay vì bám cảm tính.
 */
export function statsToText(stats: FanpageStats): string {
  if (stats.postCount === 0) return "";
  const lines: string[] = [];

  lines.push(
    `Nhịp đăng: khoảng ${stats.postsPerWeek} bài/tuần (${stats.postCount} bài trong ${stats.spanDays} ngày).`,
  );

  const mix = Object.entries(stats.formatMix)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${FORMAT_LABEL[k] || k} ${Math.round(v * 100)}%`)
    .join(", ");
  if (mix) lines.push(`Định dạng hay dùng: ${mix}.`);

  if (stats.topHours.length) {
    lines.push(`Hay đăng vào khoảng ${stats.topHours.map((h) => `${h.hour}h`).join(", ")} (giờ Việt Nam).`);
  }

  lines.push(
    `Một bài bình thường của trang được khoảng ${stats.medianLikes} like, ` +
      `${stats.medianComments} bình luận, ${stats.medianShares} chia sẻ. ` +
      `Độ dài quen thuộc khoảng ${stats.medianLength} ký tự.`,
  );

  const outliers = stats.topPosts.filter((p) => p.outperformRatio >= 1.5).slice(0, 5);
  if (outliers.length) {
    lines.push("", "Những bài ăn hơn hẳn phần còn lại của chính trang:");
    for (const p of outliers) {
      const first = p.message.split("\n")[0].slice(0, 120);
      lines.push(
        `- hơn bình thường ${p.outperformRatio} lần (${p.likes} like, ${p.comments} bình luận, ` +
          `${p.shares} chia sẻ · ${FORMAT_LABEL[p.mediaType] || p.mediaType}): "${first}"` +
          (p.permalink ? ` — ${p.permalink}` : ""),
      );
    }
  }

  return lines.join("\n");
}
