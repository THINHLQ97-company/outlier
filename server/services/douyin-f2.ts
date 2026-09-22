// Cầu nối tới sidecar Douyin (media/douyin_fetch.py).
//
// Đây là chỗ Python duy nhất còn lại trong dự án Node này. Lý do giữ: thư viện
// f2 tự ký X-Bogus/a_bogus/msToken cho Douyin và không có bản tương đương cho
// Node; viết lại phần chống bot đó sẽ hỏng mỗi lần Douyin đổi thuật toán.
//
// Trạng thái đo thật 2026-09-22: Douyin trả 403 với cookie cũ (20/08). Đường
// dẫn kỹ thuật đã thông, chỉ còn chờ cookie mới. Xem docs/COOKIE-HUONG-DAN.md.
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

const TIMEOUT_MS = 90_000;

/** Python nào chạy được f2 — venv dev, hoặc python hệ thống trong image. */
export function f2PythonPath(): string {
  const local = path.join(process.cwd(), ".tools", "f2venv", "bin", "python");
  if (fs.existsSync(local)) return local;
  return process.env.F2_PYTHON || "python3";
}

export function douyinCookieFile(): string {
  return process.env.DOUYIN_COOKIES_FILE || "";
}

export function hasDouyinCookie(): boolean {
  const f = douyinCookieFile();
  return !!f && fs.existsSync(f);
}

export interface DouyinVideo {
  ok: boolean;
  error?: string;
  awemeId?: string;
  title?: string | null;
  channelName?: string | null;
  durationSec?: number | null;
  coverUrl?: string | null;
  playUrl?: string | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  views?: number | null;
  cookieChars?: number;
}

function callSidecar(payload: Record<string, unknown>): Promise<DouyinVideo> {
  return new Promise((resolve) => {
    const script = path.join(process.cwd(), "media", "douyin_fetch.py");
    if (!fs.existsSync(script)) {
      return resolve({ ok: false, error: "Thiếu sidecar media/douyin_fetch.py." });
    }
    const child = spawn(f2PythonPath(), [script], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), TIMEOUT_MS);

    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (err += d.toString()));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, error: `Không chạy được sidecar: ${String(e).slice(0, 150)}` });
    });
    child.on("close", () => {
      clearTimeout(timer);
      const line = out.trim().split("\n").filter(Boolean).pop() || "";
      try {
        resolve(JSON.parse(line));
      } catch {
        // Nếu tới đây nghĩa là sidecar in rác ra stdout — từng xảy ra với log
        // của f2, đã chặn ở phía Python; giữ nhánh này để không nuốt lỗi.
        resolve({ ok: false, error: `Sidecar trả về không đọc được: ${(err || line).slice(0, 180)}` });
      }
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

/** Lấy một video Douyin. */
export async function fetchDouyinVideo(url: string): Promise<DouyinVideo> {
  if (!hasDouyinCookie()) {
    return { ok: false, error: "Chưa có cookie Douyin — xem docs/COOKIE-HUONG-DAN.md." };
  }
  return callSidecar({ action: "video", url, cookieFile: douyinCookieFile() });
}

/** Kiểm tra cookie còn sống không. Dùng để chẩn đoán nhanh. */
export async function checkDouyinCookie(url?: string): Promise<DouyinVideo> {
  return callSidecar({ action: "check", url, cookieFile: douyinCookieFile() });
}
