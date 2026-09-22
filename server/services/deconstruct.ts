// Bóc cấu trúc một bài: 3 giây đầu, mở vấn đề, giữ chân, twist, CTA
// (docs/PRD.md §4 J3).
//
// Hai chế độ:
//   "video"      — Gemini xem trực tiếp video (chính xác hơn, thấy được hình ảnh)
//   "transcript" — chỉ đọc lời thoại (rẻ hơn, nhưng mù phần hình)
// Chế độ nào cũng ghi lại vào `analysisMode` để người đọc biết kết quả đáng tin
// tới đâu — không giấu chuyện đã phân tích bằng cách nào.
//
// Chống bịa (cùng tinh thần P1 với Brand Profile): mọi mốc AI nêu đều kèm giây,
// và giây đó được ĐỐI CHIẾU với độ dài thật của video. Mốc nằm ngoài video bị
// loại — AI không thể mô tả một đoạn không tồn tại.
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { ytDlpPath, ffmpegLocationArgs } from "./radar-scan";
import { generateTextGemini } from "./gemini-direct";
import type { DeconstructedStructure, RetentionBeat } from "../db/schema";

const DOWNLOAD_TIMEOUT_MS = 180_000;

/** ffmpeg có trên máy không — cần để ghép luồng hình + tiếng (DASH). */
let ffmpegChecked: boolean | null = null;
export async function hasFfmpeg(): Promise<boolean> {
  if (ffmpegChecked !== null) return ffmpegChecked;
  const { code } = await run(process.env.FFMPEG_PATH || "ffmpeg", ["-version"], 10_000);
  ffmpegChecked = code === 0;
  return ffmpegChecked;
}
/** Video dài hơn mức này thì không phân tích bằng hình — quá tốn và thường không
 *  phải dạng nội dung ngắn mà công cụ này nhắm tới. */
export const MAX_VIDEO_SEC = 300;

export interface MediaInfo {
  title?: string;
  durationSec?: number;
  transcript?: string;
  filePath?: string;
  platform?: string;
}

function run(cmd: string, args: string[], timeoutMs = DOWNLOAD_TIMEOUT_MS): Promise<{ out: string; err: string; code: number }> {
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

/** Chuyển WebVTT/SRT thành text thuần kèm mốc giây. */
export function subtitleToTranscript(vtt: string): string {
  const lines = vtt.split(/\r?\n/);
  const out: string[] = [];
  let lastText = "";
  let currentSec: number | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line === "WEBVTT" || /^\d+$/.test(line)) continue;
    const m = line.match(/^(\d{2}):(\d{2}):(\d{2})[.,]\d{3}\s*-->/);
    if (m) {
      currentSec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
      continue;
    }
    if (line.startsWith("NOTE") || line.includes("-->")) continue;
    const text = line.replace(/<[^>]+>/g, "").trim();
    if (!text || text === lastText) continue; // phụ đề tự động hay lặp dòng
    lastText = text;
    out.push(currentSec !== null ? `[${currentSec}s] ${text}` : text);
  }
  return out.join("\n");
}

/**
 * Nền tảng nào KHÔNG tải trực tiếp được nữa, phải đi qua dịch vụ có phí.
 * - tiktok: yt-dlp bản mới nhất (2026.08.19) lỗi "Unexpected response from
 *   webpage request" với mọi video TikTok — đã thử, không phải do bản cũ.
 * - facebook: yt-dlp trả 404 với link bài; nhưng cào MỘT BÀI qua Apify thì
 *   lấy được đủ nội dung + lượt thích/bình luận/chia sẻ + ảnh bài.
 */
export const NEEDS_PAID_FETCH = new Set(["tiktok", "facebook", "instagram"]);

export function platformOfUrl(url: string): string | null {
  const u = url.toLowerCase();
  if (u.includes("tiktok.com")) return "tiktok";
  if (u.includes("facebook.com") || u.includes("fb.com") || u.includes("fb.watch")) return "facebook";
  if (u.includes("instagram.com")) return "instagram";
  if (u.includes("youtube.com") || u.includes("youtu.be")) return "youtube";
  if (u.includes("douyin.com")) return "douyin";
  return null;
}

/** Lấy metadata + phụ đề. KHÔNG tải video (nhẹ, nhanh). */
export async function fetchMediaInfo(url: string): Promise<MediaInfo> {
  const { out, err, code } = await run(ytDlpPath(), [
    "--dump-single-json", "--no-warnings", "--skip-download", "--socket-timeout", "20", url,
  ]);
  if (code !== 0 || !out.trim()) {
    throw new Error(`Không đọc được video: ${(err.split("\n").find((l) => l.includes("ERROR")) || "").slice(0, 160) || "công cụ trả lỗi"}`);
  }
  let meta: any;
  try { meta = JSON.parse(out); } catch { throw new Error("Không đọc được thông tin video."); }

  const durationSec = Number.isFinite(Number(meta?.duration)) ? Number(meta.duration) : undefined;
  return {
    title: meta?.title || undefined,
    durationSec,
    platform: meta?.extractor_key?.toLowerCase() || undefined,
  };
}

/** Tải phụ đề (nếu có) về dạng text kèm mốc giây. */
export async function fetchTranscript(url: string): Promise<string | undefined> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "outlier-sub-"));
  try {
    const { code } = await run(ytDlpPath(), [
      "--skip-download", "--write-auto-subs", "--write-subs",
      "--sub-langs", "vi,en,zh-Hans,zh,ja,ko",
      "--sub-format", "vtt", "--no-warnings",
      "-o", path.join(dir, "sub.%(ext)s"), url,
    ]);
    if (code !== 0) return undefined;
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".vtt"));
    if (files.length === 0) return undefined;
    const vtt = fs.readFileSync(path.join(dir, files[0]), "utf8");
    const t = subtitleToTranscript(vtt);
    return t.length > 20 ? t.slice(0, 20_000) : undefined;
  } catch {
    return undefined;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const PROMPT_HEADER = `Bạn là người phân tích nội dung ngắn (short-form video). Nhiệm vụ: bóc CÁCH TRIỂN KHAI của bài này để người khác học được phương pháp — KHÔNG phải tóm tắt nội dung.

QUY TẮC:
- Chỉ mô tả những gì THỰC SỰ có trong tư liệu được cung cấp. Không suy đoán, không tô vẽ.
- Mọi mốc phải kèm số giây (atSec) CÓ THẬT, nằm trong độ dài video.
- Không chắc mục nào thì BỎ HẲN mục đó khỏi JSON. Thiếu thì để thiếu.
- "formula" mô tả CÔNG THỨC TRIỂN KHAI (kiểu: "mở bằng câu hỏi ngược đời → nêu hiểu lầm phổ biến → chứng minh bằng ví dụ → chốt bằng lời khuyên ngắn"), tuyệt đối KHÔNG chép lại câu chữ của bài gốc.

Trả về DUY NHẤT một object JSON:
{
  "hook3s": {"atSec":0,"what":"3 giây đầu làm gì","technique":"thủ pháp dùng"},
  "problemOpen": {"atSec":0,"what":"vấn đề được mở ra","how":"mở bằng cách nào"},
  "retentionBeats": [{"atSec":0,"what":"đang diễn ra gì","whyItWorks":"vì sao giữ được người xem"}],
  "twist": {"atSec":0,"what":"chỗ bẻ hướng"},
  "cta": {"atSec":0,"what":"chốt bằng gì","style":"kiểu chốt"},
  "formula": "công thức triển khai rút gọn",
  "notes": "ghi chú về việc có nên học theo không"
}
`;

function num(v: unknown): number | null {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) && x >= 0 ? x : null;
}

/**
 * Loại bỏ mốc thời gian nằm ngoài video.
 * Đây là lớp chống bịa: AI không thể mô tả đoạn không tồn tại.
 */
export function sanitizeStructure(raw: any, durationSec?: number): { structure: DeconstructedStructure; dropped: string[] } {
  const dropped: string[] = [];
  const maxSec = durationSec && durationSec > 0 ? durationSec : null;

  const okAt = (v: unknown, label: string): number | null => {
    const s = num(v);
    if (s === null) { dropped.push(`${label}: thiếu mốc thời gian`); return null; }
    if (maxSec !== null && s > maxSec + 1) {
      dropped.push(`${label}: mốc ${Math.round(s)}s nằm ngoài video dài ${Math.round(maxSec)}s`);
      return null;
    }
    return s;
  };

  const pickPoint = (o: any, label: string, extra: string[]) => {
    if (!o || typeof o !== "object") return null;
    const at = okAt(o.atSec, label);
    if (at === null) return null;
    const what = typeof o.what === "string" ? o.what.trim() : "";
    if (!what) { dropped.push(`${label}: không mô tả gì`); return null; }
    const res: any = { atSec: at, what };
    for (const k of extra) if (typeof o[k] === "string" && o[k].trim()) res[k] = o[k].trim();
    return res;
  };

  const beats: RetentionBeat[] = [];
  if (Array.isArray(raw?.retentionBeats)) {
    for (const [i, b] of raw.retentionBeats.entries()) {
      const p = pickPoint(b, `Điểm giữ chân #${i + 1}`, ["whyItWorks"]);
      if (p) beats.push({ atSec: p.atSec, what: p.what, whyItWorks: p.whyItWorks || "" });
    }
  }

  return {
    structure: {
      hook3s: pickPoint(raw?.hook3s, "3 giây đầu", ["technique"]),
      problemOpen: pickPoint(raw?.problemOpen, "Mở vấn đề", ["how"]),
      retentionBeats: beats,
      twist: pickPoint(raw?.twist, "Twist", []),
      cta: pickPoint(raw?.cta, "Chốt (CTA)", ["style"]),
      formula: typeof raw?.formula === "string" && raw.formula.trim() ? raw.formula.trim() : null,
      notes: typeof raw?.notes === "string" && raw.notes.trim() ? raw.notes.trim() : null,
    },
    dropped,
  };
}

export interface DeconstructOutcome {
  structure: DeconstructedStructure;
  analysisMode: "video" | "transcript";
  dropped: string[];
  warning?: string;
}

/** Phân tích từ lời thoại (chế độ rẻ, mù phần hình). */
export async function deconstructFromTranscript(
  transcript: string,
  info: MediaInfo,
): Promise<DeconstructOutcome> {
  const prompt =
    PROMPT_HEADER +
    `\nLƯU Ý: bạn CHỈ có lời thoại, không xem được hình. Đừng mô tả hình ảnh, góc quay hay chữ trên màn hình — không thấy thì đừng đoán.\n` +
    `\nTIÊU ĐỀ: ${info.title || "(không rõ)"}\nĐỘ DÀI: ${info.durationSec ?? "không rõ"} giây\n\nLỜI THOẠI (kèm mốc giây):\n${transcript.slice(0, 20_000)}`;

  let out: string;
  try {
    out = await generateTextGemini(prompt);
  } catch (e: any) {
    return { structure: {}, analysisMode: "transcript", dropped: [], warning: `Không phân tích được: ${e?.message || e}` };
  }

  let parsed: any;
  try {
    const m = out.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(m ? m[0] : out);
  } catch {
    return { structure: {}, analysisMode: "transcript", dropped: [], warning: "Kết quả phân tích không đọc được." };
  }

  const { structure, dropped } = sanitizeStructure(parsed, info.durationSec);
  return { structure, analysisMode: "transcript", dropped };
}

/** Giới hạn tệp gửi inline cho Gemini (~20MB theo tài liệu; để dư cho phần mã hoá base64). */
export const MAX_INLINE_VIDEO_BYTES = 18 * 1024 * 1024;

/**
 * Tải video ở độ phân giải THẤP NHẤT còn xem được.
 * Cố ý chọn chất lượng thấp: phân tích cấu trúc chỉ cần thấy chuyện gì đang xảy
 * ra, không cần nét — tải bản nhẹ giúp nằm trong giới hạn gửi inline và nhanh hơn.
 */
export async function downloadSmallVideo(url: string, dir: string): Promise<string> {
  const target = path.join(dir, "video.mp4");
  // YouTube phần lớn chỉ còn luồng hình và tiếng TÁCH RỜI (DASH) — phải ghép
  // bằng ffmpeg, nên image phải có ffmpeg (xem Dockerfile). Chọn chất lượng
  // thấp có chủ ý: phân tích cấu trúc chỉ cần thấy chuyện gì diễn ra.
  const { code, err } = await run(ytDlpPath(), [
    "-f", "bv*[height<=480]+ba/b[height<=480]/bv*+ba/b/worst",
    ...ffmpegLocationArgs(),
    "--merge-output-format", "mp4",
    "--max-filesize", `${MAX_INLINE_VIDEO_BYTES}`,
    "--no-warnings", "--no-playlist", "--socket-timeout", "30",
    "-o", target, url,
  ]);
  if (code !== 0 || !fs.existsSync(target)) {
    const errLine = err.split("\n").find((l) => l.includes("ERROR")) || "";
    // Nguyên nhân hay gặp nhất: YouTube chỉ trả luồng hình và tiếng tách rời,
    // phải ghép bằng ffmpeg. Thiếu ffmpeg thì nói thẳng, đừng để người dùng đoán.
    if (!(await hasFfmpeg())) {
      throw new Error(
        "Máy chủ chưa có ffmpeg nên không ghép được hình và tiếng của video. " +
        "Bản chạy thật đã cài sẵn ffmpeg; nếu đang chạy ở máy phát triển thì cần cài thêm.",
      );
    }
    if (/Requested format is not available/i.test(err)) {
      throw new Error("Video này không có định dạng nào tải được (có thể bị giới hạn hoặc là phát trực tiếp).");
    }
    if (/Private video|Sign in|members-only|age/i.test(err)) {
      throw new Error("Video này bị giới hạn quyền xem nên không phân tích được.");
    }
    throw new Error(`Không tải được video: ${errLine.slice(0, 160) || "công cụ tải trả lỗi"}`);
  }
  const size = fs.statSync(target).size;
  if (size > MAX_INLINE_VIDEO_BYTES) {
    throw new Error("Video quá lớn để phân tích trực tiếp. Thử video ngắn hơn.");
  }
  return target;
}

/** Phân tích bằng cách XEM video (chính xác hơn transcript vì thấy được hình). */
export async function deconstructFromVideo(url: string, info: MediaInfo): Promise<DeconstructOutcome> {
  if (info.durationSec && info.durationSec > MAX_VIDEO_SEC) {
    return {
      structure: {}, analysisMode: "video", dropped: [],
      warning: `Video dài ${Math.round(info.durationSec)} giây, vượt mức ${MAX_VIDEO_SEC} giây mà công cụ phân tích trực tiếp. Công cụ này hợp với nội dung ngắn.`,
    };
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "outlier-vid-"));
  try {
    const file = await downloadSmallVideo(url, dir);
    const data = fs.readFileSync(file).toString("base64");

    const prompt =
      PROMPT_HEADER +
      `\nBạn XEM ĐƯỢC video. Hãy mô tả cả phần hình (cảnh quay, chữ trên màn hình, biểu cảm) lẫn phần tiếng.\n` +
      `\nTIÊU ĐỀ: ${info.title || "(không rõ)"}\nĐỘ DÀI: ${info.durationSec ?? "không rõ"} giây`;

    const { analyzeVideoGemini } = await import("./gemini-direct");
    const out = await analyzeVideoGemini(prompt, { mimeType: "video/mp4", data });

    let parsed: any;
    try {
      const m = out.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(m ? m[0] : out);
    } catch {
      return { structure: {}, analysisMode: "video", dropped: [], warning: "Kết quả phân tích không đọc được." };
    }
    const { structure, dropped } = sanitizeStructure(parsed, info.durationSec);
    return { structure, analysisMode: "video", dropped };
  } catch (e: any) {
    return { structure: {}, analysisMode: "video", dropped: [], warning: e?.message || String(e) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Chọn cách phân tích: ưu tiên XEM video; không được thì lùi về đọc lời thoại;
 * không có cả hai thì nói thẳng là không phân tích được, KHÔNG bịa ra cấu trúc.
 */
export async function deconstruct(url: string): Promise<DeconstructOutcome & { info: MediaInfo; transcript?: string }> {
  const info = await fetchMediaInfo(url);
  const transcript = await fetchTranscript(url);

  const viaVideo = await deconstructFromVideo(url, info);
  const gotSomething = (o: DeconstructOutcome) =>
    !!(o.structure.hook3s || o.structure.formula || (o.structure.retentionBeats || []).length);

  if (gotSomething(viaVideo)) return { ...viaVideo, info, transcript };

  if (transcript) {
    const viaText = await deconstructFromTranscript(transcript, info);
    return {
      ...viaText, info, transcript,
      warning: [viaVideo.warning, viaText.warning].filter(Boolean).join(" · ") || undefined,
    };
  }

  return {
    structure: {}, analysisMode: "video", dropped: [], info, transcript,
    warning: viaVideo.warning || "Không phân tích được video này (không xem được và cũng không có lời thoại).",
  };
}
