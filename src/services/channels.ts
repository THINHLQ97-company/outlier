// Kênh theo dõi client — endpoint: server/routes/channels.routes.ts. Cùng
// pattern "trả về NGAY rồi client tự poll" như Radar/Bóc cấu trúc/Viết lại
// (xem services/radar.ts::pollRadarJob) vì quét chạy nền ở backend.
import { authHeaders, asError } from "./http";
import type { WatchedChannel, WatchedChannelDetail, ChannelCreateResult } from "../types";

export async function listChannels(): Promise<WatchedChannel[]> {
  const res = await fetch("/api/channels", { headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Không tải được danh sách kênh.");
  return res.json();
}

export interface AddChannelInput {
  channelUrl: string;
  note?: string;
  useApify?: boolean;
}

// TikTok/Instagram: backend từ chối (400) kèm needsPaid=true nếu chưa gửi
// useApify:true — nơi gọi phải hiện xác nhận chi phí thật rồi gọi lại với
// useApify:true. Bọc thành lỗi có kiểu để UI phân biệt được với lỗi thường.
export class ChannelPaidRequiredError extends Error {
  readonly needsPaid = true as const;
  estimatedCostUsd: number;
  apifyConfigured: boolean;
  constructor(message: string, estimatedCostUsd: number, apifyConfigured: boolean) {
    super(message);
    this.name = "ChannelPaidRequiredError";
    this.estimatedCostUsd = estimatedCostUsd;
    this.apifyConfigured = apifyConfigured;
  }
}

// Kênh đã có sẵn trong danh sách theo dõi (409) — kèm id để UI có thể tự
// chuyển sang xem kênh đã tồn tại thay vì chỉ báo lỗi suông.
export class DuplicateChannelError extends Error {
  readonly duplicate = true as const;
  id: string;
  constructor(message: string, id: string) {
    super(message);
    this.name = "DuplicateChannelError";
    this.id = id;
  }
}

export async function addChannel(input: AddChannelInput): Promise<ChannelCreateResult> {
  const res = await fetch("/api/channels", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    if (res.status === 400) {
      const data = await res.json().catch(() => ({}) as any);
      if (data.needsPaid) {
        throw new ChannelPaidRequiredError(
          data.error || "Kênh này cần xác nhận chi phí trước khi theo dõi.",
          Number(data.estimatedCostUsd) || 0,
          !!data.apifyConfigured,
        );
      }
    }
    if (res.status === 409) {
      const data = await res.json().catch(() => ({}) as any);
      if (data.id) throw new DuplicateChannelError(data.error || "Kênh này đã có trong danh sách theo dõi.", data.id);
    }
    return asError(res, "Không thêm được kênh.");
  }
  return res.json();
}

// Trả về gần như ngay (scanStatus="scanning") — việc làm mới chạy nền, nơi
// dùng phải tự theo dõi bằng pollChannel().
export async function refreshChannel(id: string, limit?: number): Promise<ChannelCreateResult> {
  const res = await fetch(`/api/channels/${id}/refresh`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(limit ? { limit } : {}),
  });
  if (!res.ok) return asError(res, "Không làm mới được kênh.");
  return res.json();
}

export async function getChannelItems(id: string): Promise<WatchedChannelDetail> {
  const res = await fetch(`/api/channels/${id}/items`, { headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Không tải được bài của kênh.");
  return res.json();
}

export interface PatchChannelInput {
  note?: string;
  isActive?: boolean;
}

export async function patchChannel(id: string, input: PatchChannelInput): Promise<WatchedChannel> {
  const res = await fetch(`/api/channels/${id}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) return asError(res, "Không lưu được thay đổi.");
  return res.json();
}

export async function deleteChannel(id: string): Promise<void> {
  const res = await fetch(`/api/channels/${id}`, { method: "DELETE", headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Xoá kênh thất bại.");
}

export interface ChannelPollOptions {
  /** Khoảng cách giữa các lần gọi lại — mặc định 3 giây. */
  intervalMs?: number;
  /** Trần thời gian theo dõi trước khi bỏ cuộc — mặc định 5 phút. */
  timeoutMs?: number;
  onUpdate: (detail: WatchedChannelDetail) => void;
  onTimeout: () => void;
  onError: (message: string) => void;
}

/**
 * Theo dõi một kênh đang làm mới ở nền: gọi GET /api/channels/:id/items lặp
 * lại tới khi scanStatus không còn "scanning", quá hạn, hoặc bị huỷ. Tự lên
 * lịch lần gọi kế tiếp SAU KHI lần trước phản hồi xong (không dùng
 * setInterval) — port nguyên cơ chế từ pollRadarJob (services/radar.ts).
 *
 * Trả về một hàm huỷ — BẮT BUỘC gọi trong cleanup của useEffect.
 */
export function pollChannel(id: string, opts: ChannelPollOptions): () => void {
  const intervalMs = opts.intervalMs ?? 3000;
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;
  const startedAt = Date.now();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = async () => {
    if (stopped) return;
    try {
      const detail = await getChannelItems(id);
      if (stopped) return;
      opts.onUpdate(detail);
      if (detail.scanStatus !== "scanning") return; // xong (idle/error), không hẹn tiếp
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

/** Sửa số liệu bài cũ bằng dữ liệu đã lưu — miễn phí, không gọi dịch vụ nào. */
export async function repairChannel(id: string): Promise<{ checked: number; fixed: number; note: string }> {
  const res = await fetch(`/api/channels/${id}/repair`, { method: "POST", headers: authHeaders() });
  if (!res.ok) return asError(res, "Không sửa được số liệu.");
  return res.json();
}
