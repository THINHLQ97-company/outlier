// Sinh nét vẽ từ hồ sơ Thương hiệu.
//
// Vấn đề đang giải: phong cách vẽ trước đây chỉ tạo được từ ẢNH MẪU — phải có
// sẵn một ảnh đúng ý rồi mới bóc ra mô tả. Trang mới chưa có ảnh nào thì bế tắc,
// mà mỗi lần vẽ lại chọn phong cách khác nhau nên ảnh của trang không ai nhận ra
// là cùng một trang.
//
// Hồ sơ thương hiệu đã có sẵn thứ cần: trang bán gì, nói với ai, giọng nào, và
// nhận diện hình ảnh (khuôn ảnh, màu, thứ cấm xuất hiện). Từ đó suy ra một bộ
// nét vẽ nhất quán là việc làm được — và làm MỘT LẦN rồi dùng mãi thì mọi ảnh
// sau đó đồng bộ.
//
// Hai đường vào, cùng một nguyên liệu:
//   - Claude qua MCP: đọc `buildStyleBrief` rồi TỰ viết bộ trường (style_create).
//   - Giao diện web: bấm nút, server gọi Gemini với `buildStyleFromBrandPrompt`.
//
// Nguyên tắc chống bịa giữ như chỗ khác: thiếu nhận diện hình ảnh thì NÓI RÕ là
// suy từ tính cách/giọng nói, đừng để người dùng tưởng đó là màu trang đã chọn.
import type { brands, brandFanpages } from "../db/schema";
import { buildBrandBrief } from "./brand-brief";
import { generateTextGemini } from "./gemini-direct";
import { normalizeStyleJson, styleFieldGuide, missingKeyStyleFields } from "../../shared/style-fields";

type BrandRow = typeof brands.$inferSelect;
type FanpageRow = typeof brandFanpages.$inferSelect;

/** Nhận diện hình ảnh có được khai chưa — quyết định nét vẽ là "theo trang" hay "suy ra". */
export function hasVisualIdentity(row: BrandRow): boolean {
  const v = (row.visualIdentity as any)?.value;
  if (!v || typeof v !== "object") return false;
  return !!(v.template || v.palette?.length || v.mustHave?.length || v.doNots?.length);
}

/**
 * Nguyên liệu để sinh nét vẽ: brief của thương hiệu (bản dành cho việc vẽ) +
 * bảng trường cần điền. Đưa thẳng cho Claude qua MCP, hoặc nhúng vào prompt Gemini.
 */
export function buildStyleBrief(row: BrandRow, pages: FanpageRow[]): {
  brief: string;
  grounded: boolean;
  caveat?: string;
} {
  const grounded = hasVisualIdentity(row);
  return {
    brief: buildBrandBrief(row, pages, "image"),
    grounded,
    caveat: grounded
      ? undefined
      : "Thương hiệu CHƯA khai nhận diện hình ảnh (visualIdentity). Nét vẽ sinh ra là SUY RA từ tính cách và giọng nói — hợp lý nhưng không phải màu/khuôn ảnh mà chủ trang đã chọn. Hỏi chủ trang rồi ghi bằng brand_set để lần sau chắc hơn.",
  };
}

export function buildStyleFromBrandPrompt(brief: string, grounded: boolean): string {
  return `Bạn là giám đốc nghệ thuật. Đọc hồ sơ thương hiệu dưới đây và thiết kế MỘT phong cách vẽ để trang này dùng cho mọi ảnh về sau.

Phong cách phải:
- Khớp tính cách và giọng nói của trang (trang tếu thì đừng ra nét tả thực nghiêm trang).
- ${grounded ? "Tôn trọng nhận diện hình ảnh đã khai: đúng màu, đúng khuôn ảnh, không vi phạm mục cấm." : "Suy ra từ tính cách và người đọc, vì trang chưa khai nhận diện hình ảnh."}
- Cụ thể tới mức một hoạ sĩ khác đọc xong vẽ lại được gần giống, KHÔNG dùng chữ chung chung như "hiện đại", "bắt mắt", "chuyên nghiệp".
- Nhất quán nội bộ: tô phẳng thì đừng đòi ánh sáng chuyển sắc mượt.

HỒ SƠ THƯƠNG HIỆU
${brief}

Trả về ĐÚNG một đối tượng JSON, không kèm lời dẫn, với các khoá sau (bỏ khoá nào bạn không quyết được, đừng điền cho đủ):
${styleFieldGuide()}

Thêm hai khoá nữa:
- style_name (chuỗi): tên gọi ngắn cho phong cách này, tiếng Việt, 2-5 từ.
- rationale (chuỗi): 1-3 câu tiếng Việt nói vì sao phong cách này khớp trang, dẫn chiếu tới chi tiết CÓ TRONG hồ sơ.

Giá trị các trường nét vẽ viết bằng TIẾNG ANH (prompt vẽ gửi cho model ảnh); style_name và rationale viết TIẾNG VIỆT.`;
}

export interface GeneratedStyle {
  name: string;
  styleJson: Record<string, string | string[]>;
  rationale: string | null;
  grounded: boolean;
  caveat?: string;
  /** Trường then chốt model không điền được — người dùng nên bổ sung. */
  missingKeyFields: string[];
}

/**
 * Sinh nét vẽ bằng Gemini. `generate` tiêm được để test không cần gọi mạng
 * (cùng cách làm với analyzeComments trong audience-insight.ts).
 */
export async function generateStyleFromBrand(
  row: BrandRow,
  pages: FanpageRow[],
  generate: (prompt: string) => Promise<string> = (p) => generateTextGemini(p),
): Promise<GeneratedStyle> {
  const { brief, grounded, caveat } = buildStyleBrief(row, pages);
  const text = await generate(buildStyleFromBrandPrompt(brief, grounded));

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Model không trả về JSON nét vẽ.");
  let parsed: any;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch (e: any) {
    throw new Error(`Không đọc được JSON nét vẽ (${e?.message || e}).`);
  }

  const { style_name, rationale, ...fields } = parsed || {};
  const styleJson = normalizeStyleJson(fields);
  if (Object.keys(styleJson).length === 0) throw new Error("Model không mô tả được trường nét vẽ nào.");

  const name =
    (typeof style_name === "string" && style_name.trim()) || `Nét vẽ ${row.name}`.trim();

  return {
    name: name.slice(0, 80),
    styleJson,
    rationale: typeof rationale === "string" && rationale.trim() ? rationale.trim() : null,
    grounded,
    caveat,
    missingKeyFields: missingKeyStyleFields(styleJson).map((f) => f.label),
  };
}
