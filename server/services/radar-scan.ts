// Quét danh sách ứng viên — bước MIỄN PHÍ của Radar.
//
// Chiến lược chi phí (docs/ARCH.md §3): quét rộng bằng yt-dlp/f2 (không tốn tiền)
// để lấy danh sách + metadata cơ bản, lọc bớt, RỒI mới gọi Apify cho số ít ứng
// viên đầu bảng. yt-dlp trả lượt xem khá ổn nhưng thường THIẾU lượt thích và số
// người theo dõi — nên điểm chấm từ dữ liệu quét luôn bị đánh dấu tin cậy thấp.
import { spawn } from "child_process";
import path from "path";
import fs from "fs";

const SCAN_TIMEOUT_MS = 90_000;
const HARD_MAX = 100; // chặn trên, tránh quét vô tận

export interface ScanCandidate {
  platform: string;
  itemKey: string;
  url: string;
  title?: string;
  coverUrl?: string;
  durationSec?: number;
  publishedAt?: string;
  channelKey?: string;
  channelName?: string;
  views?: number;
  likes?: number;
  followerCount?: number;
}

export interface ScanOutcome {
  candidates: ScanCandidate[];
  warning?: string;
}

/** Đường dẫn yt-dlp: ưu tiên venv dev, sau đó PATH (trong Docker). */
export function ytDlpPath(): string {
  const local = path.join(process.cwd(), ".tools", "venv", "bin", "yt-dlp");
  if (fs.existsSync(local)) return local;
  return process.env.YTDLP_PATH || "yt-dlp";
}

export function isScannerAvailable(): boolean {
  const p = ytDlpPath();
  if (p.includes("/")) return fs.existsSync(p);
  return true; // nằm trên PATH — để lần chạy thật báo lỗi nếu thiếu
}

function runYtDlp(args: string[]): Promise<{ lines: string[]; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn(ytDlpPath(), args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), SCAN_TIMEOUT_MS);
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ lines: [], stderr: String(e), code: -1 });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ lines: out.split("\n").filter(Boolean), stderr: err, code: code ?? -1 });
    });
  });
}

/** Đọc số an toàn từ dữ liệu ngoài. */
function n(v: unknown): number | undefined {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) && x >= 0 ? x : undefined;
}

/** Ngày đăng: yt-dlp trả timestamp (giây) hoặc upload_date "YYYYMMDD". */
function pubDate(e: any): string | undefined {
  if (n(e?.timestamp)) return new Date(n(e.timestamp)! * 1000).toISOString();
  const d = String(e?.upload_date || "");
  if (/^\d{8}$/.test(d)) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T00:00:00.000Z`;
  return undefined;
}

/**
 * Thông tin ở cấp KÊNH (playlist), không có trong từng video.
 * Quan trọng: `channel_follower_count` chỉ xuất hiện ở đây. Đọc đúng chỗ này
 * thì quét kênh lấy được số người theo dõi MIỄN PHÍ — không phải gọi Apify.
 */
interface ChannelInfo {
  channelKey?: string;
  channelName?: string;
  followerCount?: number;
}

function toCandidate(e: any, platform: string, chan: ChannelInfo = {}): ScanCandidate | null {
  const url = e?.webpage_url || e?.url || e?.original_url;
  const id = e?.id ?? url;
  if (!url || !id) return null;
  return {
    platform,
    itemKey: String(id),
    url: String(url),
    title: e?.title || e?.description || undefined,
    coverUrl: e?.thumbnail || (Array.isArray(e?.thumbnails) && e.thumbnails.at(-1)?.url) || undefined,
    durationSec: n(e?.duration),
    publishedAt: pubDate(e),
    channelKey: e?.channel_id || e?.uploader_id || chan.channelKey || undefined,
    channelName: e?.channel || e?.uploader || chan.channelName || undefined,
    views: n(e?.view_count),
    likes: n(e?.like_count),
    // Ưu tiên số ở cấp video (hiếm khi có), rồi mới lấy ở cấp kênh.
    followerCount: n(e?.channel_follower_count) ?? chan.followerCount,
  };
}

/** Dựng target cho yt-dlp từ từ khoá hoặc link đối thủ. */
export function buildTarget(platform: string, query: string, kind: "keyword" | "competitor", limit: number): string | null {
  const q = query.trim();
  if (!q) return null;
  if (kind === "competitor") {
    // Link kênh YouTube trần trả cả playlist/shorts và hay lỗi; thêm "/videos"
    // để lấy đúng danh sách video, nhanh và ổn định hơn.
    if (/^https?:\/\/(www\.)?youtube\.com\/(@[^\/?#]+|c\/[^\/?#]+|channel\/[^\/?#]+|user\/[^\/?#]+)\/?$/i.test(q)) {
      return q.replace(/\/$/, "") + "/videos";
    }
    return q;
  }
  switch (platform) {
    case "youtube":
      return `ytsearch${limit}:${q}`;
    case "tiktok":
      // yt-dlp không có cú pháp tìm kiếm cho TikTok — dùng trang hashtag.
      return `https://www.tiktok.com/tag/${encodeURIComponent(q.replace(/^#/, "").replace(/\s+/g, ""))}`;
    default:
      return null;
  }
}

/**
 * Quét danh sách ứng viên. KHÔNG tải video, KHÔNG tốn tiền.
 * Douyin chưa hỗ trợ ở đây — cần sidecar f2 (xem docs/ARCH.md §1).
 */
export async function scanCandidates(
  platform: string,
  query: string,
  kind: "keyword" | "competitor",
  limit = 30,
): Promise<ScanOutcome> {
  const take = Math.min(Math.max(1, limit), HARD_MAX);

  if (platform === "douyin") {
    return { candidates: [], warning: "Douyin cần bộ quét riêng (f2) — chưa nối trong bản này." };
  }
  if (platform === "instagram") {
    return { candidates: [], warning: "Instagram không quét được bằng công cụ miễn phí — dùng Apify cho nền tảng này." };
  }
  const target = buildTarget(platform, query, kind, take);
  if (!target) {
    return { candidates: [], warning: `Chưa hỗ trợ quét "${platform}" bằng từ khoá.` };
  }
  if (!isScannerAvailable()) {
    return { candidates: [], warning: "Chưa cài yt-dlp nên không quét được. Trong bản chạy thật, yt-dlp nằm sẵn trong image." };
  }

  const { lines, stderr, code } = await runYtDlp([
    "--flat-playlist",       // chỉ lấy danh sách, không mở từng video
    "--dump-single-json",
    "--playlist-end", String(take),
    "--no-warnings",
    "--ignore-errors",
    "--socket-timeout", "20",
    target,
  ]);

  if (code !== 0 && lines.length === 0) {
    const msg = stderr.split("\n").find((l) => l.includes("ERROR")) || stderr.slice(0, 200);
    return { candidates: [], warning: `Không quét được: ${msg || "công cụ quét trả lỗi"}` };
  }

  const out: ScanCandidate[] = [];
  for (const line of lines) {
    let doc: any;
    try { doc = JSON.parse(line); } catch { continue; }
    // Khi quét cả kênh, doc là playlist — thông tin kênh nằm ở đây.
    const chan: ChannelInfo = {
      channelKey: doc?.channel_id || doc?.uploader_id || doc?.id || undefined,
      channelName: doc?.channel || doc?.uploader || doc?.title || undefined,
      followerCount: n(doc?.channel_follower_count),
    };
    const entries = Array.isArray(doc?.entries) ? doc.entries : [doc];
    for (const e of entries) {
      const c = toCandidate(e, platform, chan);
      if (c) out.push(c);
      if (out.length >= take) break;
    }
  }

  return {
    candidates: out,
    warning: out.length === 0 ? "Không tìm thấy kết quả nào cho truy vấn này." : undefined,
  };
}
