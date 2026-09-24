// Chấm điểm "outperform" — trả lời câu hỏi: bài này có BẬT LÊN so với mức bình
// thường của CHÍNH KÊNH ĐÓ không?
//
// Vì sao không xếp theo lượt like tuyệt đối (docs/PRD.md §4 J2):
//   kênh 2.000 follower có bài 8.000 like  → đáng học (vượt xa quy mô của nó)
//   kênh 14.000.000 follower có bài 6.000 like → không đáng (dưới mức thường ngày)
// Xếp theo like tuyệt đối sẽ đảo ngược đúng hai trường hợp này.

export interface ItemMetrics {
  views?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  followerCount?: number | null;
  publishedAt?: Date | string | null;
}

export interface ChannelBaseline {
  medianViews?: number | null;
  medianLikes?: number | null;
  sampleSize?: number | null;
}

export interface OutperformWeights {
  vsChannelMedian: number;  // vượt mốc thường ngày của kênh
  vsFollowers: number;      // tương tác so với quy mô người theo dõi
  engagementDepth: number;  // người ta có bình luận/chia sẻ không, hay chỉ lướt qua thả tim
  freshness: number;        // bài mới có giá trị tham khảo hơn
}

export const DEFAULT_WEIGHTS: OutperformWeights = {
  vsChannelMedian: 0.42,
  vsFollowers: 0.20,
  engagementDepth: 0.23,
  freshness: 0.15,
};

/**
 * Độ sâu tương tác: người ta chỉ lướt qua thả tim, hay dừng lại bình luận và
 * mang đi chia sẻ.
 *
 * Vì sao đáng một trục riêng khi muốn tìm bài để REMAKE: lượt thích gần như
 * miễn phí, ai cũng bấm. Bình luận tốn công gõ, chia sẻ tốn cả uy tín cá nhân —
 * nên tỉ lệ bình luận và chia sẻ trên lượt thích nói lên bài có thật sự chạm
 * hay không. Một bài 1000 thích / 5 bình luận là bài đẹp mắt; 300 thích / 200
 * bình luận là bài đúng chỗ ngứa, và đó mới là bài đáng học.
 *
 * Mốc tham chiếu từ dữ liệu thực tế mạng xã hội Việt Nam: bình luận thường vào
 * khoảng 2-5% lượt thích, chia sẻ khoảng 1-3%.
 */
export function engagementDepthScore(
  likes?: number | null,
  comments?: number | null,
  shares?: number | null,
): { score: number; reason: string } | null {
  const l = num(likes) ?? 0;
  const c = num(comments) ?? 0;
  const sh = num(shares) ?? 0;

  // Không có bình luận lẫn chia sẻ thì không có gì để nói — trả null thay vì 0,
  // để trục này bị loại khỏi phép tính thay vì kéo điểm xuống oan.
  if (c === 0 && sh === 0) return null;
  // Bài quá ít tương tác thì mọi tỉ lệ đều nhiễu.
  if (l + c + sh < 20) return null;

  const base = Math.max(l, 1);
  const commentRate = c / base;
  const shareRate = sh / base;

  // 5% bình luận và 3% chia sẻ coi như đạt trần của trục này.
  const cPart = Math.min(1, commentRate / 0.05);
  const sPart = Math.min(1, shareRate / 0.03);
  const score = Math.min(1, cPart * 0.6 + sPart * 0.4);

  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  let reason: string;
  if (score >= 0.7) {
    reason = `Người đọc thật sự phản ứng: ${pct(commentRate)} bình luận, ${pct(shareRate)} chia sẻ trên lượt thích`;
  } else if (score >= 0.35) {
    reason = `Có tương tác khá: ${pct(commentRate)} bình luận, ${pct(shareRate)} chia sẻ trên lượt thích`;
  } else {
    reason = `Chủ yếu chỉ thả tim — ${pct(commentRate)} bình luận, ${pct(shareRate)} chia sẻ`;
  }
  return { score, reason };
}

/** Số bài tối thiểu để mốc của kênh đáng tin. */
export const MIN_SAMPLE_FOR_BASELINE = 5;
const HALF_LIFE_DAYS = 21; // sau 21 ngày, điểm tươi còn một nửa

export interface OutperformResult {
  /** 0..1 — càng cao càng bật. */
  score: number;
  confidence: "low" | "medium" | "high";
  breakdown: {
    vsChannelMedian: number | null;
    vsFollowers: number | null;
    /** Bình luận + chia sẻ so với lượt thích — null khi chưa có số liệu. */
    engagementDepth: number | null;
    /** So với mặt bằng lần quét — chỉ có khi thiếu mốc kênh. */
    sessionRelative?: number | null;
    freshness: number;
    reasons: string[];
  };
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Nén một tỉ lệ vượt trội về thang 0..1.
 * ratio = 1 (đúng bằng mức thường) → 0.5; gấp 4 lần → ~0.79; bằng 1/4 → ~0.21.
 * Dùng log để một bài viral cực đoan không chiếm trọn thang điểm.
 */
export function squashRatio(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return 0;
  const x = Math.log2(ratio) / 4; // log2 để "gấp đôi" là đơn vị trực giác
  return 1 / (1 + Math.exp(-x * 2));
}

/** Điểm tươi theo phân rã nửa đời. */
export function freshnessScore(publishedAt: Date | string | null | undefined, now = new Date()): number {
  if (!publishedAt) return 0.5; // không biết ngày → không thưởng không phạt
  const t = publishedAt instanceof Date ? publishedAt : new Date(publishedAt);
  if (Number.isNaN(t.getTime())) return 0.5;
  const days = (now.getTime() - t.getTime()) / 86_400_000;
  if (days < 0) return 1; // lệch múi giờ nhẹ
  return Math.pow(0.5, days / HALF_LIFE_DAYS);
}

/**
 * Mốc tạm khi CHƯA có mốc riêng của kênh: median của chính lần quét này.
 * Kém chính xác hơn nhiều (so bài của kênh A với kênh B), nên chỉ dùng để xếp
 * thứ tự sơ bộ và LUÔN kèm confidence thấp + ghi rõ lý do. Có mốc kênh thật thì
 * mốc này bị bỏ qua.
 */
export interface SessionBaseline {
  medianViews?: number | null;
  medianLikes?: number | null;
}

export function scoreOutperform(
  item: ItemMetrics,
  baseline: ChannelBaseline | null,
  weights: OutperformWeights = DEFAULT_WEIGHTS,
  now = new Date(),
  session: SessionBaseline | null = null,
): OutperformResult {
  const reasons: string[] = [];
  let sessionRelative: number | null = null;
  const views = num(item.views);
  const likes = num(item.likes);
  const followers = num(item.followerCount);

  // --- Trục 1: so với mốc thường ngày của chính kênh ---
  let vsMedian: number | null = null;
  const sample = num(baseline?.sampleSize) ?? 0;
  const medViews = num(baseline?.medianViews);
  const medLikes = num(baseline?.medianLikes);

  if (sample >= MIN_SAMPLE_FOR_BASELINE && ((medViews && views) || (medLikes && likes))) {
    // Ưu tiên lượt xem; thiếu thì dùng lượt thích.
    const ratio = medViews && views ? views / medViews : (likes as number) / (medLikes as number);
    vsMedian = squashRatio(ratio);
    reasons.push(
      ratio >= 2
        ? `Vượt ${ratio.toFixed(1)} lần mức thường ngày của kênh`
        : ratio >= 1
        ? `Nhỉnh hơn mức thường ngày của kênh (${ratio.toFixed(1)} lần)`
        : `Dưới mức thường ngày của kênh (${ratio.toFixed(1)} lần)`,
    );
  } else {
    reasons.push(
      sample > 0 && sample < MIN_SAMPLE_FOR_BASELINE
        ? `Kênh mới có ${sample} bài để so sánh, chưa đủ tin cậy`
        : "Chưa có mốc so sánh của kênh này",
    );
    // Chưa có mốc kênh → so tạm với mặt bằng chung của lần quét, để còn xếp được
    // thứ tự. Đánh dấu riêng (sessionRelative) và KHÔNG nâng độ tin cậy.
    const sMedViews = num(session?.medianViews);
    const sMedLikes = num(session?.medianLikes);
    if ((sMedViews && views) || (sMedLikes && likes)) {
      const ratio = sMedViews && views ? views / sMedViews : (likes as number) / (sMedLikes as number);
      sessionRelative = squashRatio(ratio);
      reasons.push(
        ratio >= 1.5
          ? `Nổi hơn mặt bằng chung của lần quét này (${ratio.toFixed(1)} lần)`
          : ratio >= 0.7
          ? "Ngang mặt bằng chung của lần quét này"
          : `Thấp hơn mặt bằng chung của lần quét này (${ratio.toFixed(1)} lần)`,
      );
    }
  }

  // --- Trục 2: tương tác so với quy mô người theo dõi ---
  let vsFollowers: number | null = null;
  if (followers && followers > 0 && likes !== null) {
    // Mốc tham chiếu: tỉ lệ thích/follower ~3% là khá tốt trên video ngắn.
    const rate = likes / followers;
    vsFollowers = squashRatio(rate / 0.03);
    reasons.push(`Tỉ lệ thích trên người theo dõi: ${(rate * 100).toFixed(1)}%`);
  } else {
    reasons.push("Chưa có số người theo dõi để so sánh");
  }

  // --- Trục 3: độ sâu tương tác (bình luận/chia sẻ so với lượt thích) ---
  const depth = engagementDepthScore(item.likes, item.comments, item.shares);
  if (depth) reasons.push(depth.reason);
  else reasons.push("Chưa có số bình luận/chia sẻ để đánh giá mức độ chạm");

  // --- Trục 4: độ tươi ---
  const fresh = freshnessScore(item.publishedAt, now);

  // --- Gộp điểm: chỉ tính các trục có dữ liệu, rồi chuẩn hoá lại trọng số ---
  const parts: { v: number; w: number }[] = [{ v: fresh, w: weights.freshness }];
  if (vsMedian !== null) parts.push({ v: vsMedian, w: weights.vsChannelMedian });
  else if (sessionRelative !== null) parts.push({ v: sessionRelative, w: weights.vsChannelMedian });
  if (vsFollowers !== null) parts.push({ v: vsFollowers, w: weights.vsFollowers });
  if (depth) parts.push({ v: depth.score, w: weights.engagementDepth });
  const totalW = parts.reduce((s, p) => s + p.w, 0);
  const score = totalW > 0 ? parts.reduce((s, p) => s + p.v * p.w, 0) / totalW : 0;

  // --- Độ tin cậy: phụ thuộc có bao nhiêu trục thực sự có dữ liệu ---
  // Càng nhiều trục có dữ liệu thật thì điểm càng đáng tin.
  const axesWithData = [vsMedian, vsFollowers, depth?.score ?? null].filter((v) => v !== null).length;
  let confidence: OutperformResult["confidence"] = "low";
  if (axesWithData >= 3) confidence = "high";
  else if (axesWithData >= 1) confidence = "medium";
  if (confidence !== "high") {
    reasons.push("Điểm này chỉ nên tham khảo — còn thiếu số liệu để chấm chắc chắn");
  }

  return {
    score: Math.max(0, Math.min(1, score)),
    confidence,
    breakdown: {
      vsChannelMedian: vsMedian,
      vsFollowers,
      engagementDepth: depth?.score ?? null,
      freshness: fresh,
      sessionRelative,
      reasons,
    },
  };
}

/** Median chống lệch do bài viral cũ. */
export function median(values: number[]): number | null {
  const xs = values.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : Math.round((xs[mid - 1] + xs[mid]) / 2);
}
