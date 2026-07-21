// Kho template meme + ảnh tham chiếu (assets) client.
// Endpoint: server/routes/assets.routes.ts.
import { authHeaders, asError } from "./http";
import type { AssetRow, AssetKind } from "../types";
export { imageDisplayUrl } from "./http";

export async function listAssets(kind?: AssetKind): Promise<AssetRow[]> {
  const qs = kind ? `?kind=${encodeURIComponent(kind)}` : "";
  const res = await fetch(`/api/assets${qs}`, { headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Không tải được kho tham chiếu.");
  return res.json();
}

export interface CreateAssetInput {
  kind: AssetKind;
  name: string;
  note?: string;
  isShared?: boolean;
  imageDataUrl: string; // bắt buộc — data:image/...;base64,...
}

export async function createAsset(input: CreateAssetInput): Promise<AssetRow> {
  const res = await fetch("/api/assets", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) return asError(res, "Lưu asset thất bại.");
  return res.json();
}

export async function updateAsset(
  id: string,
  patch: { name?: string; note?: string; isShared?: boolean; imageDataUrl?: string }
): Promise<AssetRow> {
  const res = await fetch(`/api/assets/${id}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(patch),
  });
  if (!res.ok) return asError(res, "Cập nhật asset thất bại.");
  return res.json();
}

export async function deleteAsset(id: string): Promise<void> {
  const res = await fetch(`/api/assets/${id}`, { method: "DELETE", headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Xoá asset thất bại.");
}
