// Nhận định một bài có đáng đem đi remake không, và nói rõ vì sao.
//
// Điểm số cho biết bài bật tới đâu, nhưng người dùng cần câu trả lời dứt khoát:
// bài này ĐÁNG HỌC hay không, và học được cái gì. Ba mức thay vì một con số,
// vì con số 0.62 không nói được gì nếu không biết 0.62 là cao hay thấp.
//
// Bốn dấu hiệu quyết định, xếp theo mức quan trọng khi tìm bài để REMAKE:
//
//  1. Vượt mức thường ngày của CHÍNH kênh đó. Không so kênh này với kênh khác:
//     kênh 200 nghìn theo dõi có bài 500 thích là bài chết, kênh 2 nghìn có bài
//     500 thích là bài nổ.
//  2. Người đọc phản ứng thật — bình luận và chia sẻ, không chỉ thả tim. Thả tim
//     gần như miễn phí; gõ một câu bình luận thì tốn công.
//  3. Còn mới. Công thức của bài ba tháng trước có thể đã hết thời.
//  4. Có đủ nội dung để học — tính CẢ CHỮ TRONG ẢNH. Với fanpage giải trí, phần
//     lớn nội dung nằm ở ảnh (meme, ảnh chat, infographic) còn caption chỉ là
//     một dòng dẫn. Đo bằng độ dài caption là đo nhầm chỗ.
import type { ItemMetrics } from "./outperform";
import { engagementDepthScore, MIN_SAMPLE_FOR_BASELINE } from "./outperform";

// Cố ý KHÔNG có mức "bỏ qua": máy chấm sai thì một cái nhãn phủ định sẽ khiến
// người dùng lướt qua bài đáng làm. Bài chưa đủ dấu hiệu thì chỉ là "chưa nổi
// bật" — vẫn nằm nguyên trong danh sách, chỉ không được đẩy lên đầu.
export type VerdictLevel = "nen_lam" | "can_nhac" | "chua_noi_bat";

export interface ContentVerdict {
  level: VerdictLevel;
  label: string;
  /** Vì sao ra mức này — câu chữ cho người đọc, không phải số. */
  reason: string;
  /** Điều kiện nào đạt, điều kiện nào không. */
  signals: { name: string; passed: boolean; detail: string }[];
  /** Nếu đáng làm thì học được gì. */
  whatToLearn?: string;
}

const LABEL: Record<VerdictLevel, string> = {
  nen_lam: "Nên remake",
  can_nhac: "Cân nhắc remake",
  chua_noi_bat: "Chưa nổi bật",
};

/** Bài nào đáng đẩy lên đầu trang. */
export function isRecommended(level: VerdictLevel): boolean {
  return level === "nen_lam" || level === "can_nhac";
}

export interface VerdictInput extends ItemMetrics {
  /** Điểm vượt trội đã tính (0..1). */
  outperformScore?: number | null;
  /** Số bài dùng làm mốc cho kênh này. */
  baselineSample?: number | null;
  /** Độ dài caption. */
  textLength?: number | null;
  /** Độ dài chữ ĐỌC ĐƯỢC TỪ ẢNH — với nhiều bài, đây mới là phần chính. */
  imageTextLength?: number | null;
  /** Ảnh có phải nơi chứa nội dung chính không (từ image-read). */
  imageCarriesContent?: boolean;
  confidence?: "low" | "medium" | "high";
}

function daysSince(d?: Date | string | null): number | null {
  if (!d) return null;
  const t = new Date(d).getTime();
  if (!Number.isFinite(t)) return null;
  return (Date.now() - t) / 86_400_000;
}

export function judgeContent(input: VerdictInput): ContentVerdict {
  const signals: ContentVerdict["signals"] = [];

  // --- 1. Vượt mức thường ngày của chính kênh ---
  const score = input.outperformScore ?? null;
  const sample = input.baselineSample ?? 0;
  const hasBaseline = sample >= MIN_SAMPLE_FOR_BASELINE;
  const outperforms = score !== null && score >= 0.6;
  signals.push({
    name: "Vượt mức thường ngày của kênh",
    passed: outperforms,
    detail: !hasBaseline
      ? `Kênh mới có ${sample} bài làm mốc, chưa đủ ${MIN_SAMPLE_FOR_BASELINE} để so — điểm chỉ là tham khảo`
      : score === null
      ? "Chưa chấm điểm"
      : outperforms
      ? `Điểm ${(score * 100).toFixed(0)}/100 — bật hơn hẳn mặt bằng của kênh`
      : `Điểm ${(score * 100).toFixed(0)}/100 — quanh mức thường ngày`,
  });

  // --- 2. Người đọc phản ứng thật ---
  const depth = engagementDepthScore(input.likes, input.comments, input.shares);
  const reacts = !!depth && depth.score >= 0.35;
  signals.push({
    name: "Người đọc phản ứng thật",
    passed: reacts,
    detail: depth ? depth.reason : "Chưa có số bình luận/chia sẻ",
  });

  // --- 3. Còn mới ---
  const age = daysSince(input.publishedAt);
  const fresh = age === null ? false : age <= 45;
  signals.push({
    name: "Còn mới",
    passed: fresh,
    detail:
      age === null
        ? "Không rõ ngày đăng"
        : age <= 7
        ? `Đăng ${Math.round(age)} ngày trước — còn rất nóng`
        : age <= 45
        ? `Đăng ${Math.round(age)} ngày trước`
        : `Đăng ${Math.round(age)} ngày trước — công thức có thể đã hết thời`,
  });

  // --- 4. Có đủ nội dung để học (chữ + chữ trong ảnh) ---
  const capLen = input.textLength ?? null;
  const imgLen = input.imageTextLength ?? null;
  const known = capLen !== null || imgLen !== null;
  const total = (capLen || 0) + (imgLen || 0);
  // Ảnh chứa nội dung chính thì coi như đủ, kể cả khi chưa đọc được chữ: bóc
  // cấu trúc sẽ đọc ảnh, lúc đó mới biết.
  const enough = !known ? true : total >= 80 || !!input.imageCarriesContent;
  signals.push({
    name: "Có đủ nội dung để bóc cấu trúc",
    passed: enough,
    detail: !known
      ? "Chưa biết — sẽ rõ sau khi bóc (bóc cấu trúc có đọc cả chữ trong ảnh)"
      : imgLen
      ? `${capLen || 0} ký tự caption + ${imgLen} ký tự trong ảnh`
      : input.imageCarriesContent
      ? `Caption ngắn (${capLen || 0} ký tự) nhưng nội dung chính nằm trong ảnh`
      : enough
      ? `${total} ký tự`
      : `Chỉ ${total} ký tự và ảnh không mang nội dung — khó rút ra cách triển khai`,
  });

  const passed = signals.filter((s) => s.passed).length;

  // Hai dấu hiệu đầu quan trọng hơn hẳn hai cái sau: một bài vừa vượt mức vừa
  // khiến người ta bình luận thì đáng học kể cả khi hơi cũ.
  let level: VerdictLevel;
  let reason: string;
  if (outperforms && reacts) {
    level = "nen_lam";
    reason = "Bài này vừa bật hơn mặt bằng của kênh, vừa khiến người đọc thật sự phản ứng — đúng thứ đáng học.";
  } else if (outperforms || (reacts && fresh)) {
    level = "can_nhac";
    reason = outperforms
      ? "Bài bật hơn mặt bằng nhưng người đọc chủ yếu chỉ thả tim — có thể chỉ thắng nhờ hình ảnh hoặc thời điểm."
      : "Người đọc phản ứng tốt nhưng bài không vượt hẳn mặt bằng của kênh — xem kỹ trước khi làm theo.";
  } else {
    level = "chua_noi_bat";
    // Nói theo hướng "chưa thấy", không phải "không có": số liệu có thể thiếu,
    // và bài vẫn nằm đó để người dùng tự xem nếu muốn.
    reason =
      passed === 0
        ? "Chưa thấy dấu hiệu nổi bật — có thể do thiếu số liệu, xem trực tiếp nếu bạn thấy đáng."
        : "Chưa đủ dấu hiệu để đẩy lên đầu, nhưng vẫn xem được như mọi bài khác.";
  }

  // Mốc kênh chưa đủ tin thì hạ kết luận xuống, không khẳng định chắc nịch dựa
  // trên nền so sánh mỏng.
  if (level === "nen_lam" && !hasBaseline) {
    level = "can_nhac";
    reason = `${reason} Nhưng kênh mới có ${sample} bài làm mốc nên chưa chắc chắn.`;
  }

  const whatToLearn =
    level === "chua_noi_bat"
      ? undefined
      : reacts
      ? "Đọc bình luận để biết người ta bàn gì — đó mới là thứ nên bám khi viết lại."
      : "Bóc cấu trúc để xem cách mở bài và cách giữ người đọc.";

  return { level, label: LABEL[level], reason, signals, whatToLearn };
}
