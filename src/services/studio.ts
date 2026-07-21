// Studio "Vẽ tự do" client — sinh ảnh trực tiếp từ mô tả + nhân vật + assets.
// Endpoint: server/routes/studio.routes.ts. Kết quả là 1 PostRow origin="studio",
// status="draft" → dùng tiếp selectImage/saveOverlay/submitForApproval (posts.ts).
import { authHeaders, asError } from "./http";
import type { PostRow, AxisKey } from "../types";

export interface StudioGenerateInput {
  promptText: string; // bắt buộc
  truc?: AxisKey | null;
  characterIds?: string[]; // uuid nhân vật đã chọn (có thể rỗng)
  assetIds?: string[]; // uuid asset tham chiếu (meme_template/reference)
  aspectRatio?: string; // "1:1" | "3:4" | "9:16" (mặc định 1:1)
  isShared?: boolean; // hiện trong thư viện chung (mặc định false)
  caption?: string;
}

export async function studioGenerate(input: StudioGenerateInput): Promise<PostRow> {
  const res = await fetch("/api/studio/generate", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) return asError(res, "Vẽ ảnh Studio thất bại.");
  return res.json();
}
