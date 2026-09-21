// Dựng video từ bản viết (docs/PRD.md §4 J5).
//
// Quy trình chia bước có chủ ý vì bước sinh hình TỐN TIỀN THẬT:
//   1. Tách cảnh      — Gemini text, rẻ, sửa được trước khi tiêu tiền
//   2. Sinh từng cảnh — Veo, tốn tiền, chỉ chạy khi người dùng xác nhận
//   3. Ghép           — ffmpeg, miễn phí
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { generateTextGemini } from "./gemini-direct";

/** Giá tham khảo mỗi cảnh (USD) để ước tính TRƯỚC khi chạy. Chỉnh bằng env khi giá đổi. */
export const USD_PER_SCENE = Number(process.env.VEO_USD_PER_SCENE || 0.20);
/** Trần số cảnh mỗi video — chặn một cú bấm nhầm thành hoá đơn lớn. */
export const MAX_SCENES = Number(process.env.VIDEO_MAX_SCENES || 8);

export interface SceneDraft {
  narration: string;
  visualPrompt: string;
  durationSec: number;
}

export function estimateSceneCostUsd(count: number): number {
  return Math.max(0, count) * USD_PER_SCENE;
}

const SPLIT_PROMPT = `Bạn chia một kịch bản video ngắn thành các cảnh để dựng hình.

QUY TẮC:
- Mỗi cảnh 4-8 giây, tổng KHÔNG quá {MAX} cảnh.
- "narration" là lời dẫn của cảnh đó, lấy TỪ KỊCH BẢN, không tự thêm ý mới.
- "visualPrompt" mô tả HÌNH ẢNH cần dựng, bằng tiếng Anh, cụ thể về bối cảnh,
  góc máy, ánh sáng. KHÔNG nhắc tên thương hiệu, KHÔNG yêu cầu chữ trên hình
  (mô hình dựng chữ rất kém, chữ sẽ để phần phụ đề lo).
- Không bịa thêm nội dung ngoài kịch bản.

Trả về DUY NHẤT JSON:
{"scenes":[{"narration":"...","visualPrompt":"...","durationSec":6}]}

KỊCH BẢN:
`;

/** Bước 1 — tách kịch bản thành cảnh. Rẻ, chạy được nhiều lần. */
export async function splitIntoScenes(script: string): Promise<{ scenes: SceneDraft[]; warning?: string }> {
  if (!script.trim()) return { scenes: [], warning: "Chưa có nội dung để tách cảnh." };

  let raw: string;
  try {
    raw = await generateTextGemini(SPLIT_PROMPT.replace("{MAX}", String(MAX_SCENES)) + script.slice(0, 12_000));
  } catch (e: any) {
    return { scenes: [], warning: `Không tách được cảnh: ${e?.message || e}` };
  }

  let parsed: any;
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(m ? m[0] : raw);
  } catch {
    return { scenes: [], warning: "Kết quả tách cảnh không đọc được." };
  }

  const list = Array.isArray(parsed?.scenes) ? parsed.scenes : [];
  const scenes: SceneDraft[] = [];
  for (const s of list.slice(0, MAX_SCENES)) {
    const narration = typeof s?.narration === "string" ? s.narration.trim() : "";
    const visualPrompt = typeof s?.visualPrompt === "string" ? s.visualPrompt.trim() : "";
    if (!visualPrompt) continue; // không có mô tả hình thì không dựng được
    const d = Number(s?.durationSec);
    scenes.push({
      narration,
      visualPrompt,
      durationSec: Number.isFinite(d) && d >= 3 && d <= 10 ? Math.round(d) : 6,
    });
  }
  return {
    scenes,
    warning: scenes.length === 0 ? "Không tách được cảnh nào từ nội dung này." : undefined,
  };
}

function run(cmd: string, args: string[], timeoutMs = 300_000): Promise<{ out: string; err: string; code: number }> {
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

export function ffmpegPath(): string {
  return process.env.FFMPEG_PATH || "ffmpeg";
}

export async function hasFfmpeg(): Promise<boolean> {
  const { code } = await run(ffmpegPath(), ["-version"], 10_000);
  return code === 0;
}

/**
 * Bước 3 — ghép các clip thành một video.
 * Dùng concat demuxer: các clip do Veo sinh cùng thông số nên ghép thẳng được,
 * không cần mã hoá lại (nhanh hơn nhiều và không giảm chất lượng).
 */
export async function concatClips(clipPaths: string[], outPath: string): Promise<void> {
  if (clipPaths.length === 0) throw new Error("Chưa có cảnh nào để ghép.");
  if (!(await hasFfmpeg())) {
    throw new Error("Máy chủ chưa có ffmpeg nên không ghép được video. Bản chạy thật đã cài sẵn.");
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "outlier-concat-"));
  try {
    const listFile = path.join(dir, "list.txt");
    // Escape dấu nháy đơn theo đúng cú pháp concat demuxer của ffmpeg.
    fs.writeFileSync(listFile, clipPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n"));

    let { code, err } = await run(ffmpegPath(), [
      "-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", outPath,
    ]);

    // Clip khác thông số → copy thẳng sẽ hỏng; lúc đó mới mã hoá lại.
    if (code !== 0) {
      ({ code, err } = await run(ffmpegPath(), [
        "-y", "-f", "concat", "-safe", "0", "-i", listFile,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
        "-c:a", "aac", "-b:a", "128k", outPath,
      ]));
    }
    if (code !== 0 || !fs.existsSync(outPath)) {
      throw new Error(`Không ghép được video: ${err.split("\n").slice(-3).join(" ").slice(0, 200)}`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
