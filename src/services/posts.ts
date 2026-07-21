// VẼ + DUYỆT + ĐĂNG client. Endpoints: server/routes/images.routes.ts +
// server/routes/posts.routes.ts (Step 5/6).
import { authHeaders, asError } from "./http";
import type { PostRow, PostStatus, OverlayConfig } from "../types";

export async function listPosts(status?: PostStatus): Promise<PostRow[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  const res = await fetch(`/api/posts${qs}`, { headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Không tải được danh sách bài.");
  return res.json();
}

export async function getPost(id: string): Promise<PostRow> {
  const res = await fetch(`/api/posts/${id}`, { headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Không tải được bài.");
  return res.json();
}

export interface CalendarPost {
  id: string;
  status: PostStatus;
  caption: string | null;
  finalImageUrl: string | null;
  truc: string | null;
  createdAt: string;
  decidedAt: string | null;
  postedAt: string | null;
}

// Content calendar (theo dõi tỉ lệ 3 trục 50/30/20). Posts kèm trục (join scripts).
export async function getCalendar(): Promise<CalendarPost[]> {
  const res = await fetch("/api/calendar", { headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Không tải được lịch nội dung.");
  return res.json();
}

// FR4.2 — sinh 2 biến thể ảnh KHÔNG chữ (Gemini image qua social backend).
// Fallback sang ảnh placeholder nếu thiếu SOCIAL_BACKEND_URL (kèm cảnh báo).
export async function generateImages(scriptId: string): Promise<PostRow> {
  const res = await fetch("/api/images/generate", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ scriptId }),
  });
  if (!res.ok) return asError(res, "Sinh ảnh thất bại.");
  return res.json();
}

export async function selectImage(postId: string, imageUrl: string): Promise<PostRow> {
  const res = await fetch(`/api/posts/${postId}/select-image`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ imageUrl }),
  });
  if (!res.ok) return asError(res, "Chọn ảnh thất bại.");
  return res.json();
}

// FR4.3 — lưu overlay + ảnh cuối (export PNG kèm watermark từ Canvas editor).
export async function saveOverlay(
  postId: string,
  overlayJson: OverlayConfig,
  finalImageDataUrl: string,
  caption: string
): Promise<PostRow> {
  const res = await fetch(`/api/posts/${postId}/overlay`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ overlayJson, finalImageDataUrl, caption }),
  });
  if (!res.ok) return asError(res, "Lưu overlay thất bại.");
  return res.json();
}

// Đưa bài vào kanban "Chờ duyệt" (FR5.1).
export async function submitForApproval(postId: string): Promise<PostRow> {
  const res = await fetch(`/api/posts/${postId}/submit`, { method: "POST", headers: authHeaders() });
  if (!res.ok) return asError(res, "Gửi duyệt thất bại.");
  return res.json();
}

// FR5.2 — checklist 14 mục.
export async function saveChecklist(postId: string, checklistJson: Record<string, boolean>): Promise<PostRow> {
  const res = await fetch(`/api/posts/${postId}/checklist`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ checklistJson }),
  });
  if (!res.ok) return asError(res, "Lưu checklist thất bại.");
  return res.json();
}

export async function approvePost(postId: string): Promise<PostRow> {
  const res = await fetch(`/api/posts/${postId}/approve`, { method: "POST", headers: authHeaders() });
  if (!res.ok) return asError(res, "Duyệt bài thất bại.");
  return res.json();
}

export async function requestEdit(postId: string): Promise<PostRow> {
  const res = await fetch(`/api/posts/${postId}/request-edit`, { method: "POST", headers: authHeaders() });
  if (!res.ok) return asError(res, "Chuyển sửa thoại thất bại.");
  return res.json();
}

// FR5.3 — Rớt bắt buộc nhập lý do.
export async function rejectPost(postId: string, reason: string): Promise<PostRow> {
  const res = await fetch(`/api/posts/${postId}/reject`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ reason }),
  });
  if (!res.ok) return asError(res, "Đánh dấu rớt thất bại.");
  return res.json();
}

// FR6.2 — đánh dấu đã đăng (nhập link bài Facebook thật).
export async function markPosted(postId: string, fbPostUrl: string): Promise<PostRow> {
  const res = await fetch(`/api/posts/${postId}/mark-posted`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ fbPostUrl }),
  });
  if (!res.ok) return asError(res, "Đánh dấu đã đăng thất bại.");
  return res.json();
}
