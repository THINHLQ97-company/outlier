// Dựng video client — "Dựng video": biến một bản viết thành video, chia làm
// 4 bước có ĐIỂM DỪNG vì bước dựng hình tốn tiền thật. Endpoint:
// server/routes/videos.routes.ts.
//
// Tách cảnh (bước 1), dựng hình (bước 3), ghép (bước 4) đều chạy NỀN ở
// backend — các POST tương ứng trả về gần như ngay lập tức, client phải tự
// gọi lại GET /api/videos/:id định kỳ tới khi status ổn định (xem pollVideo
// bên dưới). Pattern giống hệt pollRemake/pollChannel.
import { authHeaders, asError } from "./http";
import type {
  VideoProject,
  VideoProjectDetail,
  VideoScene,
  VideoCreateResult,
  VideoQuote,
  VideoGenerateResult,
  VideoRenderResult,
  VideoAspectRatio,
} from "../types";

export async function listVideos(): Promise<VideoProject[]> {
  const res = await fetch("/api/videos", { headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Không tải được danh sách dự án video.");
  return res.json();
}

export async function getVideo(id: string): Promise<VideoProjectDetail> {
  const res = await fetch(`/api/videos/${id}`, { headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Không tải được dự án video.");
  return res.json();
}

export type CreateVideoInput =
  | { remakeId: string; title?: string; aspectRatio?: VideoAspectRatio }
  | { script: string; title?: string; aspectRatio?: VideoAspectRatio };

// Trả về gần như ngay (status="splitting") — tách kịch bản thành cảnh chạy
// nền, chưa tốn phí. Nơi dùng phải tự theo dõi tiến độ bằng pollVideo().
export async function createVideo(input: CreateVideoInput): Promise<VideoCreateResult> {
  const res = await fetch("/api/videos", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) return asError(res, "Tạo dự án video thất bại.");
  return res.json();
}

export interface PatchSceneInput {
  narration?: string;
  visualPrompt?: string;
  durationSec?: number;
}

// Sửa mô tả hình (visualPrompt) sẽ khiến backend xoá clip cũ của cảnh đó
// (clipKey=null, status="pending") — nơi gọi PHẢI cảnh báo người dùng trước
// nếu cảnh đã có hình.
export async function patchScene(projectId: string, sceneId: string, input: PatchSceneInput): Promise<VideoScene> {
  const res = await fetch(`/api/videos/${projectId}/scenes/${sceneId}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) return asError(res, "Không lưu được thay đổi cảnh.");
  return res.json();
}

// Ước tính chi phí TRƯỚC khi dựng hình — PHẢI hiện hộp xác nhận nêu rõ số
// cảnh + số tiền cho người dùng trước khi gọi generateVideoScenes().
export async function getVideoQuote(id: string): Promise<VideoQuote> {
  const res = await fetch(`/api/videos/${id}/quote`, { headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Không ước tính được chi phí.");
  return res.json();
}

// ===== Bước 3: dựng hình (TỐN TIỀN THẬT) — CHỈ gọi sau khi người dùng đã
// xác nhận chi phí từ getVideoQuote(). Tuyệt đối không gọi ngầm.
export async function generateVideoScenes(id: string): Promise<VideoGenerateResult> {
  const res = await fetch(`/api/videos/${id}/generate`, { method: "POST", headers: authHeaders() });
  if (!res.ok) return asError(res, "Không dựng được hình.");
  return res.json();
}

// ===== Bước 4: ghép các cảnh đã dựng thành một video (miễn phí) =====
export async function renderVideo(id: string): Promise<VideoRenderResult> {
  const res = await fetch(`/api/videos/${id}/render`, { method: "POST", headers: authHeaders() });
  if (!res.ok) return asError(res, "Không ghép được video.");
  return res.json();
}

export async function deleteVideo(id: string): Promise<void> {
  const res = await fetch(`/api/videos/${id}`, { method: "DELETE", headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Xoá dự án video thất bại.");
}

// Trạng thái dự án còn đang chạy nền ở backend — trong lúc này phải theo dõi
// bằng poll, không cho sửa cảnh.
export function isVideoBusy(status: VideoProject["status"]): boolean {
  return status === "splitting" || status === "generating" || status === "rendering";
}

export interface VideoPollOptions {
  /** Khoảng cách giữa các lần gọi lại — mặc định 3 giây. */
  intervalMs?: number;
  /** Trần thời gian theo dõi trước khi bỏ cuộc — mặc định 5 phút. */
  timeoutMs?: number;
  onUpdate: (detail: VideoProjectDetail) => void;
  onTimeout: () => void;
  onError: (message: string) => void;
}

/**
 * Theo dõi một dự án video đang chạy nền (tách cảnh / dựng hình / ghép): gọi
 * GET /api/videos/:id lặp lại tới khi status không còn "splitting"/
 * "generating"/"rendering", quá hạn, hoặc bị huỷ. Tự lên lịch lần gọi kế tiếp
 * SAU KHI lần trước phản hồi xong (không dùng setInterval) — port nguyên cơ
 * chế từ pollRemake (services/remakes.ts).
 *
 * Trả về một hàm huỷ — BẮT BUỘC gọi trong cleanup của useEffect.
 */
export function pollVideo(id: string, opts: VideoPollOptions): () => void {
  const intervalMs = opts.intervalMs ?? 3000;
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;
  const startedAt = Date.now();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = async () => {
    if (stopped) return;
    try {
      const detail = await getVideo(id);
      if (stopped) return;
      opts.onUpdate(detail);
      if (!isVideoBusy(detail.status)) return; // xong (hoặc lỗi), không hẹn tiếp
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
