// Vẽ ảnh mẫu cho một nhân vật.
//
// Tách khỏi route vì giờ có hai chỗ gọi: nút trên web và tool MCP (Claude đề
// xuất nhân vật mới thì phải vẽ được luôn ảnh mẫu, không thì nhân vật vừa tạo
// mỗi bài lại ra một kiểu).
//
// TÔN TRỌNG mô tả, không ép tư thế: có nhân vật mang ràng buộc riêng (vd "Sếp"
// không bao giờ lộ mặt — chỉ bóng lưng hoặc bàn tay). Ép vẽ chính diện là phá
// đúng thứ làm nhân vật đó nhận ra được.
import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { characters } from "../db/schema";
import { storage, newKey, parseDataUrl, internalKeyFromUrl } from "../storage";
import { generateImageGemini } from "./gemini-direct";
import { STYLE_PROMPT } from "../../shared/engine-data";

export interface CharacterForDrawing {
  id: string;
  name: string;
  promptDescription: string;
  referenceImageUrl?: string | null;
}

export function buildReferencePrompt(c: CharacterForDrawing): string {
  return `${STYLE_PROMPT}

Character reference sheet for a single character, plain neutral background, clean lines, no text.
IMPORTANT: Follow the character description below EXACTLY, including any constraints. If the description says the face is never shown / only the back, silhouette or hands are shown, then DRAW IT THAT WAY (do not invent a face). Otherwise show a clear front/three-quarter view.

${c.name}: ${c.promptDescription}`;
}

export async function generateCharacterReference(
  c: CharacterForDrawing,
): Promise<{ referenceImageUrl: string }> {
  const dataUrl = await generateImageGemini(buildReferencePrompt(c), undefined, "3:4");
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) throw new Error("Gemini trả về ảnh không hợp lệ.");

  const key = newKey("characters", parsed.ext);
  await storage.put(key, parsed.buffer);
  const referenceImageUrl = `/api/files/${key}`;

  await getDb()
    .update(characters)
    .set({ referenceImageUrl, updatedAt: new Date() })
    .where(eq(characters.id, c.id));

  // Dọn ảnh cũ sau khi ghi ảnh mới: hỏng giữa chừng thì vẫn còn ảnh cũ mà dùng.
  const oldKey = internalKeyFromUrl(c.referenceImageUrl);
  if (oldKey) await storage.delete(oldKey).catch(() => {});

  return { referenceImageUrl };
}
