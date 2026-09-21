// Brand Profile client — hồ sơ thương hiệu bóc từ tài liệu thật, mỗi field kèm
// trích dẫn nguồn. Endpoint: server/routes/brands.routes.ts.
import { authHeaders, asError } from "./http";
import type { BrandRow, BrandDetail, BrandSource, BrandField } from "../types";

export async function listBrands(): Promise<BrandRow[]> {
  const res = await fetch("/api/brands", { headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Không tải được danh sách thương hiệu.");
  return res.json();
}

export async function getBrand(id: string): Promise<BrandDetail> {
  const res = await fetch(`/api/brands/${id}`, { headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Không tải được thương hiệu.");
  return res.json();
}

export async function createBrand(input: { name: string; isShared?: boolean }): Promise<BrandRow> {
  const res = await fetch("/api/brands", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) return asError(res, "Tạo thương hiệu thất bại.");
  return res.json();
}

// Sửa tay: gửi giá trị thô (string | string[]) cho field muốn sửa, gửi `null`
// để xoá field. Server tự bọc lại thành BrandField{value, evidence:[],
// source:"manual"}.
export type BrandFieldPatch = Partial<{
  name: string;
  isShared: boolean;
  sells: string[] | null;
  audience: string | null;
  toneOfVoice: string | null;
  addressing: string | null;
  bannedTerms: string[] | null;
  allowedClaims: string[] | null;
}>;

export async function updateBrand(id: string, patch: BrandFieldPatch): Promise<BrandRow> {
  const res = await fetch(`/api/brands/${id}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(patch),
  });
  if (!res.ok) return asError(res, "Lưu thay đổi thất bại.");
  return res.json();
}

export async function deleteBrand(id: string): Promise<void> {
  const res = await fetch(`/api/brands/${id}`, { method: "DELETE", headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Xoá thương hiệu thất bại.");
}

// Thêm tài liệu nguồn — link hoặc dán văn bản. Lỗi nạp (400) là câu tiếng
// Việt dễ hiểu, hiện thẳng cho người dùng.
export async function addBrandSourceUrl(id: string, url: string): Promise<BrandSource> {
  const res = await fetch(`/api/brands/${id}/sources`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ url }),
  });
  if (!res.ok) return asError(res, "Thêm tài liệu thất bại.");
  return res.json();
}

export async function addBrandSourceText(id: string, text: string): Promise<BrandSource> {
  const res = await fetch(`/api/brands/${id}/sources`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ text }),
  });
  if (!res.ok) return asError(res, "Thêm tài liệu thất bại.");
  return res.json();
}

export async function addBrandSourcePdf(id: string, dataBase64: string, filename: string): Promise<BrandSource> {
  const res = await fetch(`/api/brands/${id}/sources/pdf`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ dataBase64, filename }),
  });
  if (!res.ok) return asError(res, "Tải PDF thất bại.");
  return res.json();
}

export async function deleteBrandSource(id: string, sourceId: string): Promise<void> {
  const res = await fetch(`/api/brands/${id}/sources/${sourceId}`, { method: "DELETE", headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Xoá tài liệu thất bại.");
}

export interface ExtractResult extends BrandRow {
  rejected: { field: string; reason: string; claimedQuote?: string }[];
}

export async function extractBrandProfile(id: string): Promise<ExtractResult> {
  const res = await fetch(`/api/brands/${id}/extract`, { method: "POST", headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Bóc hồ sơ thất bại.");
  return res.json();
}

// Đọc 1 File (input[type=file]) sang data URL base64 — dùng cho upload PDF.
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Đọc file thất bại."));
    reader.readAsDataURL(file);
  });
}

export type { BrandField };
