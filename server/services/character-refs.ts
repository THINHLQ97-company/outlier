// Gom ẢNH ĐÍNH KÈM cho công cụ vẽ và đánh số chúng — tất cả ở một chỗ.
//
// Thứ tự cố định: [ảnh mẫu từng nhân vật có trong bài] rồi [ảnh gốc của bài].
// Số hiệu (#1, #2…) sinh TỪ chính mảng ảnh đã gửi, nên đặc tả không thể trỏ
// lệch (lỗi cũ: đánh số theo vị trí trong danh sách nhân vật đầy đủ, nhân vật
// đứng trước không có ảnh là mọi số lệch một bậc).
//
// Chỉ đính nhân vật CÓ TRONG BÀI, không phải mọi nhân vật của trang: bài chỉ có
// Gèn mà đính cả ảnh Gàn thì model hay vẽ thêm Gàn vào, hoặc pha hai người
// thành một.
//
// Ảnh gốc đi kèm để model NHÌN THẤY bố cục, tư thế, cách chia khung — tả bằng
// chữ "chú ngựa dựa tường một chân co" không bao giờ chính xác bằng cho nhìn.
// Đi kèm luật thay nhân vật (xem image-spec) để model không vẽ lại chú ngựa.
import type { CharacterRow } from "../db/schema";
import { loadImageForModel, type LoadedImage } from "./image-loader";

/** Trần ảnh nhân vật: đưa quá nhiều thì model pha trộn thành một nhân vật lai. */
const MAX_CHARACTER_REFS = 3;

export interface CharacterRefs {
  images: LoadedImage[];
  /** Mỗi nhân vật kèm số hiệu ảnh mẫu (1-based) hoặc null nếu không có ảnh. */
  characters: {
    name: string;
    promptDescription?: string | null;
    refIndex: number | null;
    /** Vì sao không đính được ảnh mẫu — để ghi log và báo người dùng. */
    missingReason?: string;
  }[];
  /** Số hiệu của ảnh gốc, null nếu không đính được. */
  sourceIndex: number | null;
  sourceMissingReason?: string;
}

export async function collectCharacterRefs(
  chars: CharacterRow[],
  opts: { sourceImageUrl?: string | null } = {},
): Promise<CharacterRefs> {
  const images: LoadedImage[] = [];
  const characters: CharacterRefs["characters"] = [];

  for (const c of chars) {
    let refIndex: number | null = null;
    let missingReason: string | undefined;

    if (images.length >= MAX_CHARACTER_REFS) {
      missingReason = `đã đủ ${MAX_CHARACTER_REFS} ảnh mẫu`;
    } else if (!c.referenceImageUrl) {
      missingReason = "nhân vật chưa có ảnh mẫu trong thư viện";
    } else {
      const { image, reason } = await loadImageForModel(c.referenceImageUrl);
      if (image) {
        images.push(image);
        refIndex = images.length; // số hiệu sinh từ chính mảng ảnh
      } else {
        missingReason = reason;
      }
    }

    characters.push({ name: c.name, promptDescription: c.promptDescription, refIndex, missingReason });
  }

  // Ảnh gốc đứng CUỐI, sau mọi ảnh nhân vật.
  let sourceIndex: number | null = null;
  let sourceMissingReason: string | undefined;
  if (opts.sourceImageUrl) {
    const { image, reason } = await loadImageForModel(opts.sourceImageUrl);
    if (image) {
      images.push(image);
      sourceIndex = images.length;
    } else {
      sourceMissingReason = reason;
    }
  }

  return { images, characters, sourceIndex, sourceMissingReason };
}
