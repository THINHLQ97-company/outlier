// RAG client — kho "ảnh đã thích" (❤️) + hồ sơ sở thích.
// Endpoint: server/routes/rag.routes.ts.
import { authHeaders, asError } from "./http";
import type { RagExample, RagProfile } from "../types";

// Thả tim 1 ảnh (post) → lưu vào RAG. isShared: chia sẻ team hay chỉ riêng mình.
export async function favoriteImage(postId: string, isShared = false): Promise<void> {
  const res = await fetch("/api/rag/favorite", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ postId, isShared }),
  });
  if (!res.ok) return asError(res, "Thả tim thất bại.");
}

// Bỏ tim ảnh của mình.
export async function unfavoriteImage(postId: string): Promise<void> {
  const res = await fetch(`/api/rag/by-post/${postId}`, { method: "DELETE", headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Bỏ tim thất bại.");
}

// Danh sách postId mình đã tim (vẽ trạng thái tim trên UI).
export async function getFavoriteIds(): Promise<string[]> {
  const res = await fetch("/api/rag/favorite-ids", { headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Không tải được danh sách đã thích.");
  return res.json();
}

// Danh sách ví dụ RAG (Thư viện RAG).
export async function listRagExamples(scope: "mine" | "shared" | "all" = "all"): Promise<RagExample[]> {
  const res = await fetch(`/api/rag?scope=${encodeURIComponent(scope)}`, { headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Không tải được thư viện RAG.");
  return res.json();
}

// Xoá 1 ví dụ RAG.
export async function deleteRagExample(id: string): Promise<void> {
  const res = await fetch(`/api/rag/${id}`, { method: "DELETE", headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Xoá ví dụ RAG thất bại.");
}

// Hồ sơ sở thích đã chưng cất.
export async function getRagProfile(): Promise<RagProfile> {
  const res = await fetch("/api/rag/profile", { headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Không tải được hồ sơ RAG.");
  return res.json();
}

// Chưng cất lại hồ sơ sở thích từ các ảnh đã thích ("Cập nhật hồ sơ").
export async function rebuildRagProfile(): Promise<{ profileText: string | null; exampleCount: number }> {
  const res = await fetch("/api/rag/profile/rebuild", { method: "POST", headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Cập nhật hồ sơ RAG thất bại.");
  return res.json();
}
