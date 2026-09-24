// Remake client — "Viết lại": học cấu trúc một bài đã bóc, thay ruột bằng
// thương hiệu của mình, rồi kiểm tra trước khi đem dùng. Endpoint:
// server/routes/remakes.routes.ts.
//
// Viết nội dung (10-40s) và chỉnh theo lời yêu cầu đều chạy NỀN ở backend —
// POST trả về gần như ngay lập tức, client phải tự gọi lại GET
// /api/remakes/:id định kỳ tới khi status đổi sang "ready"/"error" (xem
// pollRemake bên dưới). Pattern giống hệt pollDeconstruction ở
// services/deconstruct.ts. Riêng /recheck là ĐỒNG BỘ — trả kết quả ngay,
// không cần poll (dùng khi người dùng tự sửa tay nội dung).
import { authHeaders, asError } from "./http";
import type { RemakeRow, RemakeCreateResult, RemakeFormat, RemakeImage, PublishedRecord } from "../types";

export async function listRemakes(): Promise<RemakeRow[]> {
  const res = await fetch("/api/remakes", { headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Không tải được danh sách bản viết.");
  return res.json();
}

export async function getRemake(id: string): Promise<RemakeRow> {
  const res = await fetch(`/api/remakes/${id}`, { headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Không tải được bản viết.");
  return res.json();
}

export interface CreateRemakeInput {
  brandId: string;
  deconstructionId: string;
  format: RemakeFormat;
}

// Trả về gần như ngay (status="pending") — viết chạy nền, nơi dùng phải tự
// theo dõi tiến độ bằng pollRemake(). Có thể kèm `hint` khi hồ sơ thương hiệu
// còn trống — PHẢI hiện cho người dùng.
export async function createRemake(input: CreateRemakeInput): Promise<RemakeCreateResult> {
  const res = await fetch("/api/remakes", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) return asError(res, "Bắt đầu viết thất bại.");
  return res.json();
}

// Yêu cầu chỉnh sửa bằng lời (vd "ngắn hơn", "đổi hook") — cũng chạy nền,
// theo dõi bằng pollRemake().
export async function reviseRemake(id: string, note: string): Promise<RemakeCreateResult> {
  const res = await fetch(`/api/remakes/${id}/revise`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ note }),
  });
  if (!res.ok) return asError(res, "Gửi yêu cầu chỉnh sửa thất bại.");
  return res.json();
}

// ĐỒNG BỘ — dùng sau khi người dùng tự sửa tay nội dung trong ô soạn thảo.
export async function recheckRemake(id: string, draft?: string): Promise<RemakeRow> {
  const res = await fetch(`/api/remakes/${id}/recheck`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(draft === undefined ? {} : { draft }),
  });
  if (!res.ok) return asError(res, "Kiểm tra lại thất bại.");
  return res.json();
}

export async function deleteRemake(id: string): Promise<void> {
  const res = await fetch(`/api/remakes/${id}`, { method: "DELETE", headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Xoá bản viết thất bại.");
}

export interface RemakePollOptions {
  /** Khoảng cách giữa các lần gọi lại — mặc định 3 giây. */
  intervalMs?: number;
  /** Trần thời gian theo dõi trước khi bỏ cuộc — mặc định 5 phút. */
  timeoutMs?: number;
  onUpdate: (row: RemakeRow) => void;
  onTimeout: () => void;
  onError: (message: string) => void;
}

/**
 * Theo dõi một bản viết đang chạy nền: gọi GET /api/remakes/:id lặp lại tới
 * khi status là "ready"/"error", quá hạn, hoặc bị huỷ. Tự lên lịch lần gọi
 * kế tiếp SAU KHI lần trước phản hồi xong (không dùng setInterval) để tránh
 * chồng lấn khi mạng chậm.
 *
 * Trả về một hàm huỷ — BẮT BUỘC gọi hàm này trong cleanup của useEffect (khi
 * đổi bản đang xem hoặc unmount) để không rò rỉ timer.
 */
export function pollRemake(id: string, opts: RemakePollOptions): () => void {
  const intervalMs = opts.intervalMs ?? 3000;
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;
  const startedAt = Date.now();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = async () => {
    if (stopped) return;
    try {
      const row = await getRemake(id);
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

// ===== Ảnh cho bản viết =====
// Vẽ mất khoảng 10-30 giây nên gọi thẳng, không cần theo dõi việc chạy nền.

export interface RemakeImageResult {
  image: RemakeImage;
  description: string;
  /** Nhân vật đã dùng làm mẫu; hasReference=false nghĩa là chỉ tả bằng chữ. */
  charactersUsed: { id: string; name: string; hasReference: boolean }[];
}

export async function generateRemakeImage(
  id: string,
  opts: { prompt?: string; aspectRatio?: string } = {},
): Promise<RemakeImageResult> {
  const res = await fetch(`/api/remakes/${id}/image`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(opts),
  });
  if (!res.ok) return asError(res, "Không vẽ được ảnh.");
  return res.json();
}

export async function selectRemakeImage(id: string, url: string): Promise<RemakeRow> {
  const res = await fetch(`/api/remakes/${id}/select-image`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ url }),
  });
  if (!res.ok) return asError(res, "Không chọn được ảnh.");
  return res.json();
}

// ===== Đăng lên fanpage =====

export interface PublishTarget {
  fanpageId: string;
  pageName: string;
  platform: string;
  pictureUrl?: string | null;
}

export async function listPublishTargets(id: string): Promise<{ targets: PublishTarget[]; note?: string }> {
  const res = await fetch(`/api/remakes/${id}/publish-targets`, { headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Không tải được danh sách trang.");
  return res.json();
}

export async function publishRemake(
  id: string,
  fanpageId: string,
  opts: { scheduledAt?: string; force?: boolean } = {},
): Promise<PublishedRecord> {
  const res = await fetch(`/api/remakes/${id}/publish`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ fanpageId, ...opts }),
  });
  if (!res.ok) return asError(res, "Không đăng được bài.");
  return res.json();
}
