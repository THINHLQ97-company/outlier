// Biến một XU HƯỚNG thành CÁCH TRIỂN KHAI để viết bài.
//
// Trước đây trend đi thẳng ra bài viết, bỏ qua bước bóc cấu trúc. Hai cái hại:
//   - Mỗi lần viết lại bịa ra một cách triển khai mới, không ai xem lại được
//     công thức đã dùng, cũng không sửa được nó.
//   - Trend không đi qua chỗ "điều hướng nội dung", nên không lái được góc bài.
//
// Giờ trend đi đúng luồng như mọi nguồn khác: trend → cách triển khai → viết
// lại (kèm hướng nội dung nếu muốn). Cùng một đường, cùng một chỗ để can thiệp.
//
// Khác biệt của trend so với một bài có sẵn: KHÔNG có bài gốc để học nhịp, nên
// cách triển khai ở đây là ĐỀ XUẤT một góc tiếp cận — và với fanpage giải trí,
// góc đó phải hài, phải bám mảng nội dung của trang, và phải né chuyện nhạy cảm.
import { generateTextGemini } from "./gemini-direct";
import type { DeconstructedStructure } from "../db/schema";

const PROMPT = `Bạn là người lên góc nội dung cho fanpage. Từ XU HƯỚNG dưới đây, đề xuất MỘT cách triển khai để trang viết bài bắt trend.

QUY TẮC:
- Đây là ĐỀ XUẤT góc tiếp cận, không phải tóm tắt tin. Đừng kể lại tin.
- Hướng HÀI HƯỚC, đùa vào TÌNH HUỐNG chứ không đùa vào người.
- Không nêu tên thật người đang bị bàn tán. Né chính trị, tôn giáo, thiên tai, tai nạn.
- Nếu trend này không đáng đu (nhạy cảm, hoặc chẳng liên quan gì tới ai), nói thẳng trong "notes".
- Không bịa số liệu, không bịa chi tiết không có trong mô tả trend.

Trả về DUY NHẤT một object JSON:
{
  "hook3s": {"what":"câu mở đầu nên làm gì để người ta dừng lại","technique":"thủ pháp"},
  "problemOpen": {"what":"vấn đề/tình huống quen thuộc được mở ra","how":"mở bằng cách nào"},
  "retentionBeats": [{"what":"ý triển khai tiếp theo","whyItWorks":"vì sao giữ được người đọc"}],
  "twist": {"what":"chỗ bẻ hướng gây cười"},
  "cta": {"what":"chốt bằng gì","style":"kiểu chốt"},
  "formula": "công thức triển khai rút gọn",
  "notes": "có nên đu trend này không, và lưu ý gì"
}`;

export async function structureFromTrend(
  title: string,
  summary: string,
  // Tiêm được để test không phải gọi mạng (cùng cách với audience-insight).
  generate: (prompt: string) => Promise<string> = (p) => generateTextGemini(p),
): Promise<{ structure: DeconstructedStructure | null; warning?: string }> {
  const trend = [title, summary].filter((x) => x?.trim()).join("\n\n").slice(0, 6000);
  if (!trend.trim()) return { structure: null, warning: "Xu hướng không có nội dung để lên góc." };

  let raw: string;
  try {
    raw = await generate(`${PROMPT}\n\nXU HƯỚNG:\n${trend}`);
  } catch (e: any) {
    return { structure: null, warning: `Không lên được góc: ${e?.message || e}` };
  }

  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    const parsed = JSON.parse(raw.slice(start, end + 1));

    // Trend không có video nên KHÔNG có mốc giây — bỏ hẳn atSec thay vì điền 0,
    // vì số 0 trông như một mốc có thật.
    const strip = (o: any) => (o && typeof o === "object" ? { ...o, atSec: undefined } : null);
    const structure: DeconstructedStructure = {
      hook3s: strip(parsed.hook3s),
      problemOpen: strip(parsed.problemOpen),
      retentionBeats: Array.isArray(parsed.retentionBeats) ? parsed.retentionBeats.map(strip).filter(Boolean) : [],
      twist: strip(parsed.twist),
      cta: strip(parsed.cta),
      formula: typeof parsed.formula === "string" ? parsed.formula : null,
      notes: typeof parsed.notes === "string" ? parsed.notes : null,
    } as any;

    if (!structure.formula) return { structure: null, warning: "Không rút ra được cách triển khai từ trend này." };
    return { structure };
  } catch (e: any) {
    return { structure: null, warning: `Kết quả không đọc được: ${e?.message || e}` };
  }
}

/** Hướng mặc định khi viết từ trend — chủ trang vẫn ghi đè được. */
export const TREND_DEFAULT_DIRECTION =
  "Viết theo hướng HÀI HƯỚC, đùa vào tình huống chứ không đùa vào người. Bám đúng mảng nội dung trang theo đuổi " +
  "và giọng của trang; trend chỉ là cái cớ để nói chuyện của trang, không phải để đưa tin.";
