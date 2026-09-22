// Trích khung hình từ video để CLAUDE TỰ NHÌN qua MCP.
//
// Vì sao cần: MCP không truyền được luồng video cho Claude. Cách hiện có là để
// Gemini xem hộ rồi Claude đọc bản mô tả bằng chữ — Claude phải tin lời một
// model khác. Nhưng MCP trả được NỘI DUNG ẢNH, nên có thể đưa thẳng vài khung
// hình chủ chốt cho Claude tự đánh giá bằng mắt.
//
// Điều đó quan trọng với việc "so với tính cách thương hiệu rồi gợi ý remake":
// chính Claude là bên đang giữ hồ sơ thương hiệu, nên để Claude tự nhìn sẽ sát
// hơn là đọc lại mô tả của model khác.
//
// Chi phí: gần như bằng không — chỉ dùng ffmpeg, không gọi dịch vụ ngoài.
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { ytDlpPath, ffmpegLocationArgs } from "./radar-scan";
import { ffmpegPath, hasFfmpeg } from "./video-build";

/** Số khung mặc định: đủ thấy nhịp bài mà không làm ngợp cửa sổ hội thoại. */
export const DEFAULT_FRAME_COUNT = 6;
export const MAX_FRAME_COUNT = 12;
/** Khung nhỏ thôi — Claude cần thấy bố cục và chuyện gì đang xảy ra, không cần nét. */
const FRAME_WIDTH = 480;

export interface VideoFrame {
  atSec: number;
  mimeType: string;
  base64: string;
  bytes: number;
}

function run(cmd: string, args: string[], timeoutMs = 240_000): Promise<{ out: string; err: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => { clearTimeout(timer); resolve({ out: "", err: String(e), code: -1 }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ out, err, code: code ?? -1 }); });
  });
}

/** Đọc độ dài video (giây) bằng ffprobe; không đọc được thì trả null. */
export async function probeDuration(file: string): Promise<number | null> {
  const probe = process.env.FFPROBE_PATH || ffmpegPath().replace(/ffmpeg$/, "ffprobe");
  const { out, code } = await run(probe, [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file,
  ], 20_000);
  if (code !== 0) return null;
  const d = Number(String(out).trim());
  return Number.isFinite(d) && d > 0 ? d : null;
}

/**
 * Chọn mốc lấy khung.
 * Không chia đều tuyệt đối: dồn thêm khung vào 20% đầu video, vì phần mở đầu là
 * chỗ quyết định người xem ở lại hay lướt qua — cũng là thứ đáng học nhất.
 */
export function pickTimestamps(durationSec: number, count: number): number[] {
  const n = Math.max(2, Math.min(count, MAX_FRAME_COUNT));
  if (durationSec <= 3) return [0];

  const head = Math.max(1, Math.round(n * 0.4));   // 40% số khung nằm ở đoạn mở
  const rest = n - head;
  const headEnd = Math.max(1, durationSec * 0.2);

  const out: number[] = [];
  for (let i = 0; i < head; i++) out.push((headEnd * i) / Math.max(1, head - 1 || 1));
  for (let i = 1; i <= rest; i++) out.push(headEnd + ((durationSec - headEnd) * i) / (rest + 1));

  return [...new Set(out.map((t) => Math.max(0, Math.min(durationSec - 0.3, Math.round(t * 10) / 10))))].sort((a, b) => a - b);
}

/** Tải video ở chất lượng thấp để trích khung. */
async function downloadForFrames(url: string, dir: string): Promise<string> {
  const target = path.join(dir, "src.mp4");
  const { code, err } = await run(ytDlpPath(), [
    "-f", "bv*[height<=480]+ba/b[height<=480]/bv*+ba/b/worst",
    ...ffmpegLocationArgs(),
    "--merge-output-format", "mp4",
    "--max-filesize", "60M",
    "--no-warnings", "--no-playlist", "--socket-timeout", "30",
    "-o", target, url,
  ]);
  if (code !== 0 || !fs.existsSync(target)) {
    if (!(await hasFfmpeg())) {
      throw new Error("Máy chủ chưa có ffmpeg nên không tách được khung hình. Bản chạy thật đã cài sẵn.");
    }
    throw new Error(`Không tải được video: ${(err.split("\n").find((l) => l.includes("ERROR")) || "").slice(0, 150) || "công cụ tải trả lỗi"}`);
  }
  return target;
}

export interface FrameOutcome {
  frames: VideoFrame[];
  durationSec: number | null;
  warning?: string;
}

/** Trích khung hình từ một link video. */
export async function extractFrames(url: string, count = DEFAULT_FRAME_COUNT): Promise<FrameOutcome> {
  if (!(await hasFfmpeg())) {
    return { frames: [], durationSec: null, warning: "Máy chủ chưa có ffmpeg nên chưa tách được khung hình." };
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "outlier-frames-"));
  try {
    const file = await downloadForFrames(url, dir);
    const durationSec = await probeDuration(file);
    if (!durationSec) return { frames: [], durationSec: null, warning: "Không đọc được độ dài video." };

    const stamps = pickTimestamps(durationSec, count);
    const frames: VideoFrame[] = [];

    for (const [i, t] of stamps.entries()) {
      const outPath = path.join(dir, `f${i}.jpg`);
      // -ss trước -i để nhảy nhanh tới mốc, không giải mã cả video.
      const { code } = await run(ffmpegPath(), [
        "-y", "-ss", String(t), "-i", file, "-frames:v", "1",
        "-vf", `scale=${FRAME_WIDTH}:-2`, "-q:v", "6", outPath,
      ], 60_000);
      if (code !== 0 || !fs.existsSync(outPath)) continue;
      const buf = fs.readFileSync(outPath);
      frames.push({ atSec: t, mimeType: "image/jpeg", base64: buf.toString("base64"), bytes: buf.length });
    }

    return {
      frames, durationSec,
      warning: frames.length === 0 ? "Không tách được khung hình nào từ video này." : undefined,
    };
  } catch (e: any) {
    return { frames: [], durationSec: null, warning: e?.message || String(e) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
