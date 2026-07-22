// VẼ + THƯ VIỆN client. Endpoints: server/routes/images.routes.ts +
// server/routes/posts.routes.ts + server/routes/gallery.routes.ts. Bản tinh
// giản: đã bỏ workflow DUYỆT/ĐĂNG (checklist/approve/request-edit/reject/
// mark-posted) và lịch nội dung (/api/calendar) — các endpoint này đã gỡ khỏi
// server (xem posts.routes.ts), KHÔNG còn hàm client tương ứng ở đây.
import { authHeaders, asError } from "./http";
import type { PostRow, PostStatus, OverlayConfig, GalleryPost, AssetRow, AssetKind } from "../types";

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

// Vẽ lại 2 biến thể ảnh cho post đã có (dùng lại prompt/tham số Studio đã lưu).
// Chỉ cho phép khi post đang ở khâu VẼ (draft/sua_thoai).
export async function regenerateImages(postId: string): Promise<PostRow> {
  const res = await fetch(`/api/posts/${postId}/regenerate-images`, {
    method: "POST",
    headers: authHeaders(false),
  });
  if (!res.ok) return asError(res, "Vẽ lại ảnh thất bại.");
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

// Lưu overlay + ảnh cuối (export PNG kèm watermark từ Canvas editor).
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

// Thư viện ảnh — post đã có ảnh (kèm trục + quyền sở hữu). scope: mine|shared|all.
export async function getGallery(scope?: "mine" | "shared" | "all"): Promise<GalleryPost[]> {
  const qs = scope ? `?scope=${encodeURIComponent(scope)}` : "";
  const res = await fetch(`/api/gallery${qs}`, { headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Không tải được thư viện ảnh.");
  return res.json();
}

// Lưu ảnh cuối của 1 post sang assets (kho tham chiếu). kind mặc định "reference".
export async function savePostAsAsset(
  postId: string,
  payload: { name: string; kind?: AssetKind; isShared?: boolean }
): Promise<AssetRow> {
  const res = await fetch(`/api/gallery/${postId}/save-as-asset`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) return asError(res, "Lưu ảnh thành asset thất bại.");
  return res.json();
}

// Xoá 1 ảnh khỏi thư viện (chỉ người tạo hoặc admin).
export async function deleteGalleryPost(postId: string): Promise<void> {
  const res = await fetch(`/api/gallery/${postId}`, { method: "DELETE", headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Xoá ảnh thất bại.");
}
