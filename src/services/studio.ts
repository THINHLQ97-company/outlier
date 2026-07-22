// Studio "Vẽ tự do" client — sinh ảnh trực tiếp từ mô tả + nhân vật + assets.
// Endpoint: server/routes/studio.routes.ts. Kết quả là 1 PostRow origin="studio",
// status="draft" → dùng tiếp selectImage/saveOverlay/submitForApproval (posts.ts).
import { authHeaders, asError } from "./http";
import type { PostRow, AxisKey, DialogueLine } from "../types";

export interface StudioGenerateInput {
  promptText: string; // bắt buộc
  characterIds?: string[]; // uuid nhân vật đã chọn (có thể rỗng)
  assetIds?: string[]; // uuid asset tham chiếu (meme_template/reference)
  styleId?: string | null; // uuid phong cách (thư viện styles); rỗng → mặc định
  dialogue?: DialogueLine[]; // lời thoại gắn nhân vật (có thoại → model vẽ bong bóng)
  aspectRatio?: string; // "1:1" | "3:4" | "9:16" (mặc định 1:1)
  panelLayout?: string; // key PANEL_LAYOUTS (1/2/4/auto)
  isShared?: boolean; // hiện trong thư viện chung (mặc định false)
  caption?: string;
  // Deprecated (server bỏ qua): Studio không còn chọn trục / phong cách ART_STYLES
  // cứng — phong cách nay lấy từ thư viện styles qua styleId. Giữ optional để
  // trang Studio hiện tại còn build được trong lúc frontend chưa cập nhật.
  truc?: AxisKey | null;
  artStyle?: string;
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
