// Rate-limit in-memory cho các endpoint nhạy cảm (login, OAuth authorize).
// App chạy 1 container nên bộ đếm trong process là đủ; nếu sau này scale ngang
// thì chuyển sang Postgres/Redis. Cố ý KHÔNG thêm dependency mới.
import type { Request, Response, NextFunction } from "express";

interface Bucket {
  count: number;
  resetAt: number;
  blockedUntil?: number;
}

const buckets = new Map<string, Bucket>();

// Dọn định kỳ để Map không phình theo số IP đã từng gọi.
const SWEEP_MS = 5 * 60_000;
setInterval(() => {
  const now = Date.now();
  for (const [key, b] of buckets) {
    if (b.resetAt < now && (!b.blockedUntil || b.blockedUntil < now)) buckets.delete(key);
  }
}, SWEEP_MS).unref?.();

export interface RateLimitOptions {
  /** Số lần cho phép trong một cửa sổ. */
  max: number;
  /** Độ dài cửa sổ (ms). */
  windowMs: number;
  /** Khoá thêm bao lâu khi vượt ngưỡng (ms). */
  blockMs: number;
  /** Nhãn để tách bộ đếm giữa các endpoint. */
  name: string;
}

function clientKey(req: Request, name: string): string {
  // Sau Traefik/Coolify nên ưu tiên X-Forwarded-For (IP đầu tiên = client thật).
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const ip = fwd || req.socket.remoteAddress || "unknown";
  return `${name}:${ip}`;
}

export function rateLimit(opts: RateLimitOptions) {
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = clientKey(req, opts.name);
    let b = buckets.get(key);

    if (b?.blockedUntil && b.blockedUntil > now) {
      const retry = Math.ceil((b.blockedUntil - now) / 1000);
      res.setHeader("Retry-After", String(retry));
      return res.status(429).json({ error: `Bạn thử quá nhiều lần. Vui lòng đợi ${retry} giây.` });
    }

    if (!b || b.resetAt < now) {
      b = { count: 0, resetAt: now + opts.windowMs };
      buckets.set(key, b);
    }

    b.count += 1;
    if (b.count > opts.max) {
      b.blockedUntil = now + opts.blockMs;
      const retry = Math.ceil(opts.blockMs / 1000);
      res.setHeader("Retry-After", String(retry));
      console.warn(`[rate-limit] chặn ${key} — vượt ${opts.max} lần/${opts.windowMs}ms`);
      return res.status(429).json({ error: `Bạn thử quá nhiều lần. Vui lòng đợi ${retry} giây.` });
    }

    next();
  };
}

/** Xoá bộ đếm sau khi đăng nhập thành công — không phạt người gõ đúng. */
export function resetRateLimit(req: Request, name: string) {
  buckets.delete(clientKey(req, name));
}
