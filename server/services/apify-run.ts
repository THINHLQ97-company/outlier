// MỘT cửa duy nhất để chạy actor Apify kiểu đồng bộ (run-sync-get-dataset-items).
//
// Lỗi đã gặp (2026-10-09, task #6207): `402 actor-memory-limit-exceeded`. Không
// phải hết dung lượng lưu trữ — tài khoản Apify có TRẦN RAM cho các lượt chạy
// ĐỒNG THỜI (16GB). Ba chỗ gọi (enrich, lấy bài lẻ, lấy bình luận) mỗi chỗ tự
// gọi riêng, không ai biết ai đang chạy, mỗi lượt chiếm RAM mặc định của actor
// (thường 4GB). Vài người cùng quét là chạm trần.
//
// Tệ hơn: khi app thôi chờ (hết thời gian phía mình) thì lượt chạy bên Apify
// VẪN CHẠY TIẾP và vẫn giữ RAM — nên lần bấm lại tiếp theo càng dễ đụng trần.
//
// Nên ở đây:
//   1. HÀNG ĐỢI  — tối đa APIFY_MAX_CONCURRENT_RUNS lượt chạy cùng lúc (mặc định 2).
//   2. HẠN CHẠY  — gửi `timeout` cho Apify, ngắn hơn thời gian app chờ, để Apify
//                  tự dừng lượt chạy khi app đã bỏ cuộc — không còn lượt chạy mồ côi.
//   3. RAM       — APIFY_RUN_MEMORY_MB nếu có khai (không ép mặc định: actor có
//                  RAM tối thiểu riêng, ép thấp hơn là actor từ chối chạy).
//   4. THỬ LẠI   — gặp 402 hết RAM thì đợi rồi thử lại; vẫn hết thì báo tiếng Việt.

const API_BASE = "https://api.apify.com/v2";

/** Thời gian chờ giữa các lần thử lại khi Apify báo hết RAM. */
const MEMORY_RETRY_DELAYS_MS = [20_000, 40_000];

export const APIFY_BUSY_MESSAGE =
  "Apify đang bận (đang có nhiều lượt quét chạy cùng lúc, hết bộ nhớ cho phép). Đợi 1–2 phút rồi bấm lại nhé.";

function maxConcurrent(): number {
  const n = Number(process.env.APIFY_MAX_CONCURRENT_RUNS);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 2;
}

function memoryMb(): number | null {
  const n = Number(process.env.APIFY_RUN_MEMORY_MB);
  // Apify chỉ nhận lũy thừa của 2, từ 128MB.
  if (!Number.isFinite(n) || n < 128) return null;
  return 2 ** Math.floor(Math.log2(n));
}

// ── Hàng đợi trong tiến trình ─────────────────────────────────────────────
// App chạy một container, nên hàng đợi trong bộ nhớ là đủ.
let running = 0;
const waiters: (() => void)[] = [];

async function acquire(): Promise<void> {
  if (running < maxConcurrent()) {
    running++;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  // Người nhả chỗ đã chuyển suất cho mình — `running` giữ nguyên.
}

function release(): void {
  const next = waiters.shift();
  if (next) next();
  else running = Math.max(0, running - 1);
}

/** Để test và để ghi log: đang chạy bao nhiêu, đang đợi bao nhiêu. */
export function apifyQueueState() {
  return { running, waiting: waiters.length, max: maxConcurrent() };
}

export function isMemoryLimitError(status: number, body: string): boolean {
  return status === 402 && /memory-limit|memory limit/i.test(body);
}

/** URL chạy đồng bộ, kèm trần tiền, hạn chạy phía Apify và (nếu có) RAM. */
export function buildRunSyncUrl(
  actorId: string,
  opts: { maxTotalChargeUsd: number; clientTimeoutMs: number; memoryMb?: number | null },
): string {
  // Hạn phía Apify ngắn hơn app chờ 15 giây: Apify dừng trước, app còn kịp nhận
  // phần dữ liệu đã có thay vì tự cắt ngang rồi để lượt chạy mồ côi.
  const timeoutSecs = Math.max(30, Math.floor(opts.clientTimeoutMs / 1000) - 15);
  const params = new URLSearchParams({
    maxTotalChargeUsd: String(opts.maxTotalChargeUsd),
    timeout: String(timeoutSecs),
  });
  if (opts.memoryMb) params.set("memory", String(opts.memoryMb));
  return `${API_BASE}/acts/${encodeURIComponent(actorId)}/run-sync-get-dataset-items?${params}`;
}

export interface ApifyRunResponse {
  status: number;
  ok: boolean;
  body: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Chạy actor đồng bộ, trả về NGUYÊN VĂN phản hồi để nơi gọi tự đọc như trước.
 * Hết RAM sau mọi lần thử thì vẫn trả 402 — nơi gọi dùng `apifyErrorMessage`
 * để ra câu báo lỗi dễ hiểu.
 */
export async function runApifySync(
  actorId: string,
  input: Record<string, any>,
  opts: {
    token: string;
    maxTotalChargeUsd: number;
    clientTimeoutMs: number;
    /** Để test — mặc định đợi thật. */
    retryDelaysMs?: number[];
  },
): Promise<ApifyRunResponse> {
  const delays = opts.retryDelaysMs ?? MEMORY_RETRY_DELAYS_MS;
  const url = buildRunSyncUrl(actorId, {
    maxTotalChargeUsd: opts.maxTotalChargeUsd,
    clientTimeoutMs: opts.clientTimeoutMs,
    memoryMb: memoryMb(),
  });

  for (let attempt = 0; ; attempt++) {
    await acquire();
    let res: ApifyRunResponse;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.clientTimeoutMs);
    try {
      const r = await fetch(url, {
        method: "POST",
        signal: ctrl.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.token}` },
        body: JSON.stringify(input),
      });
      res = { status: r.status, ok: r.ok, body: await r.text() };
    } catch (e: any) {
      if (e?.name === "AbortError") {
        throw new Error(`Apify chạy quá ${Math.round(opts.clientTimeoutMs / 1000)} giây, đã dừng chờ.`);
      }
      throw e;
    } finally {
      clearTimeout(timer);
      release();
    }

    if (isMemoryLimitError(res.status, res.body) && attempt < delays.length) {
      console.warn(
        `[apify] ${actorId}: hết RAM đồng thời (402), thử lại sau ${delays[attempt] / 1000}s (lần ${attempt + 1}/${delays.length})`,
      );
      await sleep(delays[attempt]);
      continue;
    }
    return res;
  }
}

/** Câu báo lỗi cho người dùng từ một phản hồi không thành công. */
export function apifyErrorMessage(res: ApifyRunResponse): string {
  if (isMemoryLimitError(res.status, res.body)) return APIFY_BUSY_MESSAGE;
  return `Apify ${res.status}: ${res.body.slice(0, 200)}`;
}
