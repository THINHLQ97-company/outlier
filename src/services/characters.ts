// Character reference library client — CRUD đầy đủ (menu "Nhân vật").
// Endpoint: server/routes/characters.routes.ts.
import { authHeaders, asError } from "./http";
import type { CharacterRow, CharacterKind } from "../types";

export async function listCharacters(): Promise<CharacterRow[]> {
  const res = await fetch("/api/characters", { headers: authHeaders(false) });
  if (!res.ok) return asError(res, "Không tải được thư viện nhân vật.");
  return res.json();
}

export interface CharacterInput {
  name: string;
  kind: CharacterKind;
  promptDescription: string;
  personality?: string;
  catchphrase?: string;
  refImageDataUrl?: string; // data:image/...;base64,... — upload thủ công
}

export async function createCharacter(input: CharacterInput): Promise<CharacterRow> {
  const res = await fetch("/api/characters", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(input),
  });
  if (!res.ok) return asError(res, "Lưu nhân vật thất bại.");
  return res.json();
}

export async function updateCharacter(id: string, patch: Partial<CharacterInput>): Promise<CharacterRow> {
  const res = await fetch(`/api/characters/${id}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(patch),
  });
  if (!res.ok) return asError(res, "Cập nhật nhân vật thất bại.");
  return res.json();
}

export async function deleteCharacter(id: string): Promise<void> {
  const res = await fetch(`/api/characters/${id}`, {
    method: "DELETE",
    headers: authHeaders(false),
  });
  if (!res.ok) return asError(res, "Xoá nhân vật thất bại.");
}

// AI vẽ ảnh reference mới từ promptDescription hiện có (server gọi Gemini
// trực tiếp — có thể mất vài chục giây, UI cần hiện loading state riêng).
export async function generateCharacterReference(id: string): Promise<CharacterRow> {
  const res = await fetch(`/api/characters/${id}/generate-reference`, {
    method: "POST",
    headers: authHeaders(false),
  });
  if (!res.ok) return asError(res, "Sinh ảnh AI thất bại.");
  return res.json();
}

// imageDisplayUrl đã chuyển sang services/http.ts (dùng chung cho ảnh nhân vật
// lẫn ảnh bài viết). Re-export để không phải sửa import ở Characters.tsx.
export { imageDisplayUrl } from "./http";

// Convert 1 File (input[type=file]) sang data URL base64 để gửi lên
// refImageDataUrl (createCharacter/updateCharacter).
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Đọc file ảnh thất bại."));
    reader.readAsDataURL(file);
  });
}
