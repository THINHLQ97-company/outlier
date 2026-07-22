// Studio "Sáng tạo" client — sinh ảnh trực tiếp từ mô tả + nhân vật + assets +
// phong cách + lời thoại. Endpoint: server/routes/studio.routes.ts. Kết quả là
// 1 PostRow origin="studio", status="draft" → dùng tiếp selectImage/saveOverlay
// (services/posts.ts) rồi lưu thẳng vào Thư viện (không còn khâu gửi duyệt).
import { authHeaders, asError } from "./http";
import type { PostRow, DialogueLine } from "../types";

export interface StudioGenerateInput {
  promptText: string; // bắt buộc — mô tả bối cảnh
  characterIds?: string[]; // uuid nhân vật đã chọn (có thể rỗng)
  assetIds?: string[]; // uuid asset tham chiếu (meme_template/reference)
  styleId?: string | null; // uuid phong cách (thư viện styles); rỗng → mặc định
  dialogue?: DialogueLine[]; // lời thoại gắn nhân vật (có thoại → model vẽ bong bóng)
  aspectRatio?: string; // "1:1" | "3:4" | "9:16" (mặc định 1:1)
  panelLayout?: string; // key PANEL_LAYOUTS (1/2/4/auto)
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

export interface ScenarioVariant {
  title: string;
  scene: string;
  characters: string[]; // tên nhân vật
  dialogue: DialogueLine[];
  panelLayout: string; // "1" | "2"
}

export interface ScenarioResult {
  variants: ScenarioVariant[];
  isDemo: boolean;
  warning?: string;
}

// "AI viết kịch bản hài" — biến ý tưởng thô thành 3 kịch bản (bối cảnh + nhân
// vật + lời thoại) để điền vào form Studio.
export async function suggestScenario(idea: string, characterHints?: string[]): Promise<ScenarioResult> {
  const res = await fetch("/api/studio/suggest-scenario", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ idea, characterHints }),
  });
  if (!res.ok) return asError(res, "AI viết kịch bản thất bại.");
  return res.json();
}
