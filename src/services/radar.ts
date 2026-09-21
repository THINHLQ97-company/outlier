// Radar client — tìm content đang "bật lên" trong ngách. Endpoint:
// server/routes/radar.routes.ts. Hai bước TÁCH RỜI cố ý: quét (miễn phí) rồi
// bổ sung số liệu (tốn tiền qua Apify, chỉ chạy khi người dùng chủ động bấm).
//
// Cả quét và bổ sung số liệu đều chạy NỀN ở backend — POST trả về gần như
// ngay lập tức với status="scanning"/"enriching", client phải tự gọi lại
// GET /api/radar/:id định kỳ tới khi status đổi sang "ready"/"error"
// (xem pollRadarJob bên dưới). Đây là thay đổi cố ý để tránh proxy
// (Traefik/Coolify) ngắt request giữ mở quá lâu.
import { authHeaders, asError } from "./http";
import type { RadarJob, RadarJobDetail, RadarCreateResult, RadarEnrichQuote, RadarEnrichResult, RadarQueryKind } from "../types";

export async function listRadarJobs(): Promise<RadarJob[]> {
  const res = await fetch("/api/radar", { headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Không tải được danh sách phiên quét.");
  return res.json();
}

export interface CreateRadarInput {
  query: string;
  queryKind: RadarQueryKind;
  platforms: string[];
  limit?: number;
  brandId?: string;
}

// Trả về gần như ngay (status="scanning") — việc quét chạy nền, nơi dùng phải
// tự theo dõi tiến độ bằng pollRadarJob().
export async function createRadarJob(input: CreateRadarInput): Promise<RadarCreateResult> {
  const res = await fetch("/api/radar", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) return asError(res, "Quét thất bại.");
  return res.json();
}

export async function getRadarJob(id: string): Promise<RadarJobDetail> {
  const res = await fetch(`/api/radar/${id}`, { headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Không tải được kết quả phiên quét.");
  return res.json();
}

export async function getEnrichQuote(id: string, top: number): Promise<RadarEnrichQuote> {
  const res = await fetch(`/api/radar/${id}/enrich-quote?top=${top}`, { headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Không ước tính được chi phí.");
  return res.json();
}

// Trả về gần như ngay — hoặc "không còn gì để bổ sung" (enriched:0, không cần
// theo dõi tiếp), hoặc "đã bắt đầu" (polling:true, status="enriching") và nơi
// dùng phải tự theo dõi bằng pollRadarJob().
export async function enrichRadarJob(id: string, top: number): Promise<RadarEnrichResult> {
  const res = await fetch(`/api/radar/${id}/enrich`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ top }),
  });
  if (!res.ok) return asError(res, "Không bổ sung được số liệu.");
  return res.json();
}

export async function deleteRadarJob(id: string): Promise<void> {
  const res = await fetch(`/api/radar/${id}`, { method: "DELETE", headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Xoá phiên quét thất bại.");
}

export interface RadarPollOptions {
  /** Khoảng cách giữa các lần gọi lại — mặc định 3 giây. */
  intervalMs?: number;
  /** Trần thời gian theo dõi trước khi bỏ cuộc — mặc định 5 phút. */
  timeoutMs?: number;
  onUpdate: (detail: RadarJobDetail) => void;
  onTimeout: () => void;
  onError: (message: string) => void;
}

/**
 * Theo dõi một phiên quét/bổ sung số liệu đang chạy nền: gọi GET
 * /api/radar/:id lặp lại tới khi status là "ready"/"error", quá hạn, hoặc bị
 * huỷ. Tự lên lịch lần gọi kế tiếp SAU KHI lần trước phản hồi xong (không
 * dùng setInterval) để tránh chồng lấn khi mạng chậm.
 *
 * Trả về một hàm huỷ — BẮT BUỘC gọi hàm này trong cleanup của useEffect (khi
 * đổi phiên đang xem hoặc unmount) để không rò rỉ timer.
 */
export function pollRadarJob(id: string, opts: RadarPollOptions): () => void {
  const intervalMs = opts.intervalMs ?? 3000;
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;
  const startedAt = Date.now();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = async () => {
    if (stopped) return;
    try {
      const detail = await getRadarJob(id);
      if (stopped) return;
      opts.onUpdate(detail);
      if (detail.status === "ready" || detail.status === "error") return; // xong, không hẹn tiếp
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
