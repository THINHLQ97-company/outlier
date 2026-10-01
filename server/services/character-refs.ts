// Gom ảnh mẫu nhân vật VÀ đánh số chúng — hai việc này phải làm cùng một chỗ.
//
// Lỗi đã xảy ra: hai việc nằm ở hai nơi. Một hàm đọc ảnh và BỎ QUA nhân vật
// không có ảnh; hàm kia đánh số theo vị trí trong danh sách ĐẦY ĐỦ. Chỉ cần
// nhân vật đầu không có ảnh là mọi số đều lệch một bậc:
//
//   chars = [Gàn (không ảnh), Gèn (có ảnh)]
//   ảnh gửi đi = [ảnh Gèn]            → ảnh này là #1
//   đặc tả ghi  = Gèn giữ ngoại hình theo ảnh #2   ← trỏ vào ảnh không tồn tại
//
// Model nhận lệnh "giữ ngoại hình theo ảnh #2" trong khi chỉ có một ảnh, nên nó
// tự bịa ra ngoại hình — ra một nhân vật không giống ảnh mẫu chút nào.
//
// Nên giờ: một hàm duy nhất trả về CẢ danh sách ảnh LẪN số hiệu của từng nhân
// vật. Số hiệu sinh ra từ chính mảng ảnh, nên không thể lệch.
import type { CharacterRow } from "../db/schema";
import { internalKeyFromUrl, storage, contentTypeForKey } from "../storage";

/** Trần ảnh mẫu: đưa quá nhiều thì model pha trộn thành một nhân vật lai. */
const MAX_REFS = 3;

export interface CharacterRefs {
  images: { mimeType: string; data: string }[];
  /** Mỗi nhân vật kèm số hiệu ảnh mẫu (1-based) hoặc null nếu không có ảnh. */
  characters: { name: string; promptDescription?: string | null; refIndex: number | null }[];
}

export async function collectCharacterRefs(chars: CharacterRow[]): Promise<CharacterRefs> {
  const images: { mimeType: string; data: string }[] = [];
  const characters: CharacterRefs["characters"] = [];

  for (const c of chars) {
    let refIndex: number | null = null;

    // Chỉ nhận ảnh ĐỌC ĐƯỢC THẬT. Có đường dẫn mà file đã mất cũng coi như
    // không có — trỏ vào ảnh không mở được thì model bịa ngoại hình.
    if (images.length < MAX_REFS) {
      const key = internalKeyFromUrl(c.referenceImageUrl);
      if (key) {
        try {
          const buf = await storage.get(key);
          if (buf?.length) {
            // Khai ĐÚNG kiểu file. Ghi cứng image/png trong khi ảnh là jpg thì
            // model có thể bỏ qua cả tấm ảnh.
            images.push({ mimeType: contentTypeForKey(key), data: buf.toString("base64") });
            refIndex = images.length; // số hiệu sinh từ chính mảng ảnh
          }
        } catch {
          // Không đọc được thì vẫn vẽ, chỉ kém nhất quán — không chặn cả bài.
        }
      }
    }

    characters.push({ name: c.name, promptDescription: c.promptDescription, refIndex });
  }

  return { images, characters };
}
