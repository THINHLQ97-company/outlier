// Deconstruct client — "Bóc cấu trúc": vì sao một bài giữ được người xem.
// Endpoint: server/routes/deconstruct.routes.ts.
//
// Phân tích (tải video + gọi model) mất 1-3 phút nên chạy NỀN ở backend —
// POST trả về gần như ngay lập tức với status="downloading", client phải tự
// gọi lại GET /api/deconstructions/:id định kỳ tới khi status đổi sang
// "ready"/"error" (xem pollDeconstruction bên dưới). Pattern giống hệt
// pollRadarJob ở services/radar.ts — cố ý để tránh proxy (Traefik/Coolify)
// ngắt request giữ mở quá lâu.
import { authHeaders, asError } from "./http";
import type { DeconstructionRow, DeconstructionCreateResult, AudienceInsight } from "../types";

export async function listDeconstructions(): Promise<DeconstructionRow[]> {
  const res = await fetch("/api/deconstructions", { headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Không tải được danh sách bản phân tích.");
  return res.json();
}

export async function getDeconstruction(id: string): Promise<DeconstructionRow> {
  const res = await fetch(`/api/deconstructions/${id}`, { headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Không tải được bản phân tích.");
  return res.json();
}

export interface CreateDeconstructionInput {
  url?: string;
  radarItemId?: string;
  /** Đồng ý trả phí để lấy nội dung (TikTok/Facebook/Instagram). */
  allowPaid?: boolean;
}

// Trả về gần như ngay (status="downloading") — phân tích chạy nền, nơi dùng
// phải tự theo dõi tiến độ bằng pollDeconstruction().
export async function createDeconstruction(input: CreateDeconstructionInput): Promise<DeconstructionCreateResult> {
  const res = await fetch("/api/deconstructions", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) return asError(res, "Bắt đầu phân tích thất bại.");
  return res.json();
}

export async function deleteDeconstruction(id: string): Promise<void> {
  const res = await fetch(`/api/deconstructions/${id}`, { method: "DELETE", headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Xoá bản phân tích thất bại.");
}

export interface DeconstructPollOptions {
  /** Khoảng cách giữa các lần gọi lại — mặc định 3 giây. */
  intervalMs?: number;
  /** Trần thời gian theo dõi trước khi bỏ cuộc — mặc định 5 phút. */
  timeoutMs?: number;
  onUpdate: (row: DeconstructionRow) => void;
  onTimeout: () => void;
  onError: (message: string) => void;
}

/**
 * Theo dõi một bản phân tích đang chạy nền: gọi GET /api/deconstructions/:id
 * lặp lại tới khi status là "ready"/"error", quá hạn, hoặc bị huỷ. Tự lên
 * lịch lần gọi kế tiếp SAU KHI lần trước phản hồi xong (không dùng
 * setInterval) để tránh chồng lấn khi mạng chậm.
 *
 * Trả về một hàm huỷ — BẮT BUỘC gọi hàm này trong cleanup của useEffect (khi
 * đổi bản đang xem hoặc unmount) để không rò rỉ timer.
 */
export function pollDeconstruction(id: string, opts: DeconstructPollOptions): () => void {
  const intervalMs = opts.intervalMs ?? 3000;
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;
  const startedAt = Date.now();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = async () => {
    if (stopped) return;
    try {
      const row = await getDeconstruction(id);
      if (stopped) return;
      opts.onUpdate(row);
      if (row.status === "ready" || row.status === "error") return; // xong, không hẹn tiếp
    } catch (e: any) {
      if (!stopped) opts.onError(e?.message || "Không theo dõi được tiến độ, thử tải lại trang.");
      return;
    }
    if (stopped) return;
    if (Date.now() - startedAt >= timeoutMs) {
      opts.onTimeout();
      return;
    }
    timer = setTimeout(tick, intervalMs);
  };

  timer = setTimeout(tick, intervalMs);

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
  };
}

export interface CommentAnalysisResult {
  fetched: number;
  costUsd: number;
  insight: AudienceInsight;
  warning?: string;
}

/**
 * Lấy bình luận của bài gốc rồi phân tích.
 * Tốn tiền với Facebook/TikTok (mỗi bình luận một lượt); YouTube miễn phí.
 */
export async function analyzePostComments(id: string, limit = 100): Promise<CommentAnalysisResult> {
  const res = await fetch(`/api/deconstructions/${id}/comments`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ limit }),
  });
  if (!res.ok) return asError(res, "Không phân tích được bình luận.");
  return res.json();
}
