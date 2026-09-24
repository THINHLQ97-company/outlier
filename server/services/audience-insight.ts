// Rút ra người xem thật sự quan tâm gì, từ phần bình luận.
//
// Vì sao đây là phần đáng giá nhất: bóc cấu trúc cho biết bài được DỰNG thế nào,
// còn phần này cho biết nó CHẠM vào đâu. Hai thứ hay lệch nhau — bài kể chuyện A
// nhưng cả trăm bình luận đang hỏi về B. Remake theo B trúng hơn nhiều.
//
// Chỗ dễ bịa nhất là số lượng: hỏi model "cụm này có bao nhiêu bình luận" thì nó
// đoán. Nên ở đây model chỉ có một việc — gán mỗi bình luận vào một cụm theo số
// thứ tự — còn ĐẾM thì code tự đếm lại, và câu trích dẫn cũng lấy từ bình luận
// thật theo số thứ tự đó. Model không tự viết ra được một câu trích nào.
import { generateTextGemini } from "./gemini-direct";
import type { AudienceInsight } from "../db/schema";

/** Dưới ngưỡng này thì mọi kết luận đều là đoán mò. */
export const MIN_COMMENTS_FOR_INSIGHT = 15;

/** Trần số bình luận đưa vào một lượt phân tích, tránh prompt quá dài. */
const MAX_COMMENTS_PER_RUN = 300;

export interface CommentInput {
  text: string;
  likes?: number;
}

function buildPrompt(comments: CommentInput[]): string {
  const numbered = comments
    .map((c, i) => `[${i}] ${c.text.replace(/\s+/g, " ").slice(0, 300)}`)
    .join("\n");

  return `Dưới đây là ${comments.length} bình luận dưới một bài đăng, mỗi bình luận có một số thứ tự trong ngoặc vuông.

${numbered}

Hãy đọc và cho biết NGƯỜI XEM ĐANG QUAN TÂM GÌ.

Trả về JSON đúng dạng:
{
  "themes": [
    {
      "label": "tên cụm chủ đề, ngắn gọn, bằng tiếng Việt",
      "commentIds": [0, 5, 12],
      "sentiment": "tích cực" | "tiêu cực" | "trung tính" | "lẫn lộn"
    }
  ],
  "questions": ["câu hỏi được hỏi đi hỏi lại"],
  "objections": ["điều người đọc phản đối hoặc nghi ngờ"],
  "remakeAngles": ["góc nội dung nên làm tiếp, bám đúng thứ họ quan tâm"]
}

Quy tắc bắt buộc:
- "commentIds" phải là SỐ THỨ TỰ THẬT lấy từ danh sách trên. Không được bịa số.
- Mỗi bình luận chỉ thuộc MỘT cụm. Bình luận vô nghĩa ("hay quá", thả tim, tag tên) thì bỏ qua, đừng gượng ép xếp cụm.
- Xếp cụm theo mức được nhắc nhiều, cụm đông nhất lên đầu. Tối đa 6 cụm.
- "questions" chỉ lấy câu thật sự lặp lại ở nhiều bình luận, không phải mọi câu hỏi.
- Nếu bình luận không có gì đáng rút (toàn thả tim, spam, tag tên), trả về themes rỗng — đừng cố nặn ra.
- Trả về ĐÚNG JSON, không thêm lời dẫn.`;
}

export interface AnalyzeResult {
  insight: AudienceInsight;
}

/**
 * `generate` cho phép truyền bộ sinh văn bản khác vào khi kiểm thử — nhờ vậy
 * test chạy được mà không cần tính năng giả lập module còn thử nghiệm của Node.
 */
export async function analyzeComments(
  comments: CommentInput[],
  generate: (prompt: string) => Promise<string> = generateTextGemini,
): Promise<AnalyzeResult> {
  const clean = comments.filter((c) => c.text.trim().length >= 2);

  if (clean.length < MIN_COMMENTS_FOR_INSIGHT) {
    // Mẫu quá nhỏ thì nói thẳng thay vì trả về một bản phân tích trông có vẻ
    // chắc chắn — vài bình luận không đại diện cho ai cả.
    return {
      insight: {
        sampleSize: clean.length,
        themes: [],
        questions: [],
        objections: [],
        remakeAngles: [],
        warning: `Chỉ có ${clean.length} bình luận, dưới mức ${MIN_COMMENTS_FOR_INSIGHT} cần thiết để nói được điều gì chắc chắn.`,
      },
    };
  }

  const used = clean.slice(0, MAX_COMMENTS_PER_RUN);
  const raw = await generate(buildPrompt(used));

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Không đọc được kết quả phân tích. Thử lại.");
  }

  const themesRaw: any[] = Array.isArray(parsed?.themes) ? parsed.themes : [];
  const seen = new Set<number>();
  const themes: AudienceInsight["themes"] = [];

  for (const t of themesRaw.slice(0, 6)) {
    const label = String(t?.label || "").trim();
    if (!label) continue;

    // Chỉ nhận số thứ tự CÓ THẬT và chưa dùng ở cụm khác. Model hay gán trùng
    // một bình luận vào nhiều cụm, làm tổng cộng lại vượt quá số bình luận thật.
    const ids: number[] = (Array.isArray(t?.commentIds) ? t.commentIds : [])
      .map((n: any) => Number(n))
      .filter((n: number) => Number.isInteger(n) && n >= 0 && n < used.length && !seen.has(n));
    for (const id of ids) seen.add(id);
    if (ids.length === 0) continue;

    // Câu trích lấy từ bình luận thật, ưu tiên cái được thích nhiều nhất trong cụm.
    const quotes = ids
      .map((id) => used[id])
      .sort((a, b) => (b.likes || 0) - (a.likes || 0))
      .slice(0, 3)
      .map((c) => (c.text.length > 200 ? `${c.text.slice(0, 200)}…` : c.text));

    const sentiment = ["tích cực", "tiêu cực", "trung tính", "lẫn lộn"].includes(t?.sentiment)
      ? t.sentiment
      : undefined;

    themes.push({ label, count: ids.length, quotes, sentiment });
  }

  themes.sort((a, b) => b.count - a.count);

  const strList = (v: any, max: number): string[] =>
    (Array.isArray(v) ? v : [])
      .map((x: any) => String(x).trim())
      .filter(Boolean)
      .slice(0, max);

  const covered = themes.reduce((sum, t) => sum + t.count, 0);
  const warnings: string[] = [];
  if (themes.length === 0) {
    warnings.push("Bình luận không có gì đáng rút — phần lớn là thả tim, tag tên hoặc spam.");
  } else if (covered < used.length * 0.3) {
    // Nói rõ khi phần lớn bình luận không xếp được vào cụm nào: kết luận lúc đó
    // chỉ dựa trên một nhúm nhỏ.
    warnings.push(
      `Chỉ ${covered}/${used.length} bình luận xếp được vào cụm — phần còn lại không có nội dung gì rõ ràng.`,
    );
  }
  if (clean.length > MAX_COMMENTS_PER_RUN) {
    warnings.push(`Có ${clean.length} bình luận, chỉ đọc ${MAX_COMMENTS_PER_RUN} cái đầu.`);
  }

  return {
    insight: {
      sampleSize: used.length,
      themes,
      questions: strList(parsed?.questions, 8),
      objections: strList(parsed?.objections, 6),
      remakeAngles: strList(parsed?.remakeAngles, 5),
      warning: warnings.length ? warnings.join(" ") : undefined,
    },
  };
}

/** Viết thành mấy dòng để nhét vào prompt remake. */
export function insightToText(insight: AudienceInsight): string {
  if (!insight || insight.themes.length === 0) return "";
  const lines: string[] = [`Người đọc bài gốc quan tâm gì (rút từ ${insight.sampleSize} bình luận):`];

  for (const t of insight.themes) {
    lines.push(`- ${t.label} — ${t.count} bình luận${t.sentiment ? `, giọng ${t.sentiment}` : ""}`);
    if (t.quotes[0]) lines.push(`  ví dụ: "${t.quotes[0]}"`);
  }
  if (insight.questions.length) {
    lines.push("", "Câu hỏi lặp lại:", ...insight.questions.map((q) => `- ${q}`));
  }
  if (insight.objections.length) {
    lines.push("", "Điều họ phản đối hoặc nghi ngờ:", ...insight.objections.map((o) => `- ${o}`));
  }
  return lines.join("\n");
}
