// Từ một trend đang nóng → mấy phương án nội dung đúng giọng trang, đã soi
// guardrail.
//
// Khoảng trống mà nó lấp: trước đây Claude tìm được drama nóng, ghi vào tín hiệu,
// gợi ý được một góc hài — rồi dừng ở đó, người vận hành tự viết tiếp. Mà "viết
// tiếp" chính là chỗ dễ sai giọng nhất, vì người viết thường nhớ trang bán gì
// nhưng quên trang KHÔNG làm gì.
//
// Ba thứ ép vào đây thay vì gửi gắm trong lời dặn:
//  1. Bản brief của trang luôn được nhét vào prompt — không có brand thì từ chối
//     chứ không viết giọng chung chung.
//  2. Đầu ra chạy qua runGuardrail; phương án dính lỗi "block" vẫn trả về nhưng
//     đánh dấu rõ, để người duyệt thấy nó sai ở đâu chứ không im lặng bỏ đi.
//  3. Nội dung bài viết và nội dung video sinh theo hai khuôn khác nhau — gộp
//     một khuôn thì ra thứ nửa nọ nửa kia, không dùng được bên nào.
import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { brands, brandFanpages } from "../db/schema";
import { buildBrandBrief } from "./brand-brief";
import { generateTextGemini } from "./gemini-direct";
import { runGuardrail, type GuardrailReport } from "./guardrail";

export type DraftKind = "post" | "video";

export interface TrendDraft {
  angle: string;        // góc tiếp cận, một câu
  hook: string;         // câu mở đầu / 3 giây đầu
  body: string;         // nội dung chính (caption hoặc lời thoại theo cảnh)
  cta?: string;         // kêu gọi, một câu
  /** Comment trang tự đăng dưới bài. Nhiều trang chốt đơn ở đây chứ không ở
   *  caption, nên phải tách thành từng comment dùng được, không dồn một ô. */
  selfComments?: string[];
  imagePrompt?: string; // gợi ý ảnh, bám nhận diện hình ảnh của trang
  whyItWorks: string;   // vì sao góc này hợp trang này, không phải hợp chung chung
  guardrail: GuardrailReport;
  blocked: boolean;
}

export interface TrendDraftResult {
  brandId: string;
  brandName: string;
  kind: DraftKind;
  trend: string;
  drafts: TrendDraft[];
  warnings: string[];
}

function postShape(): string {
  return `Mỗi phương án gồm:
- "angle": góc tiếp cận, MỘT câu
- "hook": câu đầu tiên người đọc nhìn thấy
- "body": nội dung bài, viết sẵn để đăng được luôn
- "cta": lời kêu gọi NGẮN, MỘT câu (bỏ trống nếu trang không chốt đơn kiểu đó)
- "selfComments": mảng các comment trang tự đăng dưới bài, MỖI COMMENT MỘT PHẦN TỬ — nếu hồ sơ nói trang chốt đơn ở comment thì để CTA ở đây
- "imagePrompt": mô tả ảnh cần vẽ, bám đúng khuôn ảnh quen thuộc của trang
- "whyItWorks": vì sao góc này hợp TRANG NÀY`;
}

function videoShape(): string {
  return `Mỗi phương án gồm:
- "angle": góc tiếp cận, MỘT câu
- "hook": 3 giây đầu — thứ giữ người xem lại, viết đúng lời sẽ nói
- "body": kịch bản theo cảnh, mỗi cảnh một dòng dạng "[0-3s] hình: ... | lời: ..."
- "cta": câu chốt cuối video (bỏ trống nếu không hợp)
- "selfComments": mảng comment trang tự đăng dưới video, mỗi comment một phần tử
- "imagePrompt": mô tả khung hình mở đầu
- "whyItWorks": vì sao góc này hợp TRANG NÀY`;
}

function buildPrompt(brief: string, trend: string, kind: DraftKind, count: number, extra?: string): string {
  return `Bạn đang viết cho một fanpage cụ thể. Đây là hồ sơ của trang:

${brief}

---

Trend đang nóng cần bắt:
${trend}
${extra ? `\nYêu cầu thêm từ người vận hành:\n${extra}\n` : ""}
---

Viết ${count} phương án nội dung ${kind === "video" ? "VIDEO" : "BÀI VIẾT"} để trang này bắt trend trên.

${kind === "video" ? videoShape() : postShape()}

Bắt buộc:
- Viết đúng giọng và ngữ vực của trang. Nếu hồ sơ nói trang có nhiều ngữ vực, chọn đúng ngữ vực cho tình huống này.
- Tuân thủ tuyệt đối phần "KHÔNG BAO GIỜ" trong hồ sơ.
- Không nêu tên thật của người đang bị bàn tán trong drama.
- Không chê bai cá nhân. Đùa vào tình huống, không đùa vào người.
- Nếu hồ sơ ghi mục nào "chưa có dữ liệu", ĐỪNG tự bịa ra thay — cứ tránh chỗ đó.
- Nếu trend này không hợp với trang (trái mảng nội dung, hoặc động vào điều cấm), hãy nói thẳng trong "whyItWorks" là KHÔNG NÊN ĐU và giải thích, thay vì cố viết cho có.

Trả về JSON đúng dạng: {"drafts": [ ... ]}`;
}

export async function draftFromTrend(opts: {
  brandId: string;
  trend: string;
  kind?: DraftKind;
  count?: number;
  extra?: string;
}): Promise<TrendDraftResult> {
  const kind: DraftKind = opts.kind === "video" ? "video" : "post";
  const count = Math.min(5, Math.max(1, opts.count || 3));
  const trend = String(opts.trend || "").trim();
  if (!trend) throw new Error("Cần mô tả trend (càng cụ thể càng tốt: chuyện gì, ai đang bàn, vì sao nóng).");

  const db = getDb();
  const [brand] = await db.select().from(brands).where(eq(brands.id, opts.brandId));
  if (!brand) throw new Error("Không tìm thấy thương hiệu.");
  const pages = await db.select().from(brandFanpages).where(eq(brandFanpages.brandId, opts.brandId));

  const brief = buildBrandBrief(brand as any, pages as any, kind === "video" ? "image" : "writing");

  const warnings: string[] = [];
  // Hồ sơ trống thì có viết cũng ra giọng chung chung — nói thẳng thay vì để
  // người dùng tưởng đã đúng giọng trang mình.
  if (!brand.personality && !brand.toneOfVoice && !brand.pageRole) {
    warnings.push(
      "Hồ sơ trang gần như trống (chưa có pageRole, tính cách, giọng nói) — nội dung sinh ra sẽ chung chung. " +
        "Nối fanpage với Meta rồi quét bài về (fanpage_sync_posts + brand_extract), hoặc khai tay bằng brand_set.",
    );
  }
  if (kind === "post" && !brand.visualIdentity) {
    warnings.push("Chưa có visualIdentity — gợi ý ảnh sẽ đúng nội dung nhưng chưa chắc đúng nhận diện của trang.");
  }

  const raw = await generateTextGemini(buildPrompt(brief, trend, kind, count, opts.extra));
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Model trả về không phải JSON đọc được. Thử lại, hoặc mô tả trend ngắn gọn hơn.");
  }

  const list: any[] = Array.isArray(parsed?.drafts) ? parsed.drafts : Array.isArray(parsed) ? parsed : [];
  if (list.length === 0) throw new Error("Không sinh được phương án nào.");

  const guard = {
    bannedTerms: brand.bannedTerms as any,
    addressing: brand.addressing as any,
    allowedClaims: brand.allowedClaims as any,
    sells: brand.sells as any,
  };

  const drafts: TrendDraft[] = list.slice(0, count).map((d: any) => {
    const body = String(d?.body || "").trim();
    const hook = String(d?.hook || "").trim();
    const cta = d?.cta ? String(d.cta).trim() : undefined;
    const selfComments = Array.isArray(d?.selfComments)
      ? d.selfComments.map((c: any) => String(c).trim()).filter(Boolean)
      : undefined;
    // Soi tất cả những gì sẽ đăng lên, không riêng bài: câu mở đầu là chỗ dễ vi
    // phạm nhất vì nó viết để gây chú ý, còn comment là chỗ hay bị quên soi
    // nhất — mà với nhiều trang, chốt đơn lại nằm đúng ở đó.
    const report = runGuardrail([hook, body, cta, ...(selfComments || [])].filter(Boolean).join("\n"), {
      brand: guard,
    });
    return {
      angle: String(d?.angle || "").trim(),
      hook,
      body,
      cta,
      selfComments,
      imagePrompt: d?.imagePrompt ? String(d.imagePrompt).trim() : undefined,
      whyItWorks: String(d?.whyItWorks || "").trim(),
      guardrail: report,
      blocked: report.issues.some((i) => i.severity === "block"),
    };
  });

  const blockedCount = drafts.filter((d) => d.blocked).length;
  if (blockedCount > 0) {
    warnings.push(`${blockedCount}/${drafts.length} phương án vi phạm giới hạn của trang — xem mục guardrail của từng phương án trước khi dùng.`);
  }

  return {
    brandId: brand.id,
    brandName: brand.name,
    kind,
    trend,
    drafts,
    warnings,
  };
}
