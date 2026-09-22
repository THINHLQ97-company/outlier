// Brand Profile client — hồ sơ thương hiệu bóc từ tài liệu thật, mỗi field kèm
// trích dẫn nguồn. Endpoint: server/routes/brands.routes.ts.
import { authHeaders, asError } from "./http";
import type { BrandRow, BrandDetail, BrandSource, BrandField, BrandFanpage } from "../types";

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


// ===== Trang của chính thương hiệu + nối Meta =====
// Nối được Meta thì đọc bài của page mình qua Graph API: miễn phí, đầy đủ, và
// bóc tính cách ra có câu trích từ bài thật. Apify chỉ còn dùng cho page người khác.

export async function addBrandFanpage(
  brandId: string,
  input: { pageUrl: string; platform?: string; pageName?: string; isPrimary?: boolean },
): Promise<BrandFanpage> {
  const res = await fetch(`/api/brands/${brandId}/fanpages`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) return asError(res, "Không thêm được trang.");
  return res.json();
}

export async function deleteBrandFanpage(brandId: string, fanpageId: string): Promise<void> {
  const res = await fetch(`/api/brands/${brandId}/fanpages/${fanpageId}`, {
    method: "DELETE",
    headers: authHeaders(false),
  });
  if (!res.ok) return asError(res, "Không xoá được trang.");
}

export interface MetaConnectResult {
  connected: true;
  page: { id: string; name: string; username?: string; category?: string; followers?: number };
}

/** Token đi trong body, không bao giờ trong URL. */
export async function connectFanpageMeta(
  brandId: string,
  fanpageId: string,
  pageAccessToken: string,
  pageId?: string,
): Promise<MetaConnectResult> {
  const res = await fetch(`/api/brands/${brandId}/fanpages/${fanpageId}/meta/connect`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(pageId ? { pageAccessToken, pageId } : { pageAccessToken }),
  });
  if (!res.ok) return asError(res, "Không nối được với Meta.");
  return res.json();
}

export async function disconnectFanpageMeta(brandId: string, fanpageId: string): Promise<void> {
  const res = await fetch(`/api/brands/${brandId}/fanpages/${fanpageId}/meta/disconnect`, {
    method: "POST",
    headers: authHeaders(),
    body: "{}",
  });
  if (!res.ok) return asError(res, "Không ngắt được kết nối.");
}

export interface MetaSyncResult {
  fanpageId: string;
  pageName: string;
  postCount: number;
  sourceId: string;
  charCount: number;
  videoRatio: number;
  note: string;
}

export async function syncFanpagePosts(
  brandId: string,
  fanpageId: string,
  limit = 100,
): Promise<MetaSyncResult> {
  const res = await fetch(`/api/brands/${brandId}/fanpages/${fanpageId}/meta/sync`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ limit }),
  });
  if (!res.ok) return asError(res, "Không quét được bài.");
  return res.json();
}

/** Bản tóm tắt nhân vật của trang — đúng thứ Claude đọc qua MCP. */
export async function getBrandBrief(brandId: string, forWhat: "writing" | "image" = "writing"): Promise<string> {
  const res = await fetch(`/api/brands/${brandId}/brief?for=${forWhat}`, { headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Không dựng được bản tóm tắt.");
  return (await res.json()).brief;
}

export type { BrandField };
