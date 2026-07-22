// Thư viện phong cách vẽ (styles) client. Endpoints: server/routes/styles.routes.ts.
// Mỗi phong cách = ảnh tham chiếu + mô tả JSON (styleJson) — chọn khi vẽ ở Studio.
import { authHeaders, asError } from "./http";
import type { StyleRow } from "../types";

export async function listStyles(): Promise<StyleRow[]> {
  const res = await fetch("/api/styles", { headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Không tải được thư viện phong cách.");
  return res.json();
}

// Tạo phong cách từ ảnh mẫu — server tự phân tích ảnh sinh styleJson (thiếu
// GEMINI_API_KEY → styleJson rỗng + warning, vẫn tạo được).
export async function createStyle(input: {
  name: string;
  imageDataUrl: string;
  isShared?: boolean;
}): Promise<StyleRow> {
  const res = await fetch("/api/styles", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) return asError(res, "Tạo phong cách thất bại.");
  return res.json();
}

export async function updateStyle(
  id: string,
  patch: { name?: string; isShared?: boolean; styleJson?: Record<string, any>; imageDataUrl?: string }
): Promise<StyleRow> {
  const res = await fetch(`/api/styles/${id}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(patch),
  });
  if (!res.ok) return asError(res, "Cập nhật phong cách thất bại.");
  return res.json();
}

export async function deleteStyle(id: string): Promise<{ ok: true }> {
  const res = await fetch(`/api/styles/${id}`, { method: "DELETE", headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Xoá phong cách thất bại.");
  return res.json();
}

// Sinh ảnh minh hoạ cho phong cách từ styleJson (cần GEMINI_API_KEY; thiếu → 502).
export async function generateStyleReference(id: string): Promise<StyleRow> {
  const res = await fetch(`/api/styles/${id}/generate-reference`, {
    method: "POST",
    headers: authHeaders(false),
  });
  if (!res.ok) return asError(res, "Sinh ảnh minh hoạ phong cách thất bại.");
  return res.json();
}
