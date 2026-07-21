// LỌC — rule-based scoring suggestion (FR2.3) + threshold routing (FR2.2).
// `total` chỉ cộng 4 tiêu chí cộng dồn (do_nong, do_cham, do_hop_truc,
// tuoi_tho — mỗi tiêu chí thang 1-5, tổng tối đa 20, khớp ngưỡng ≥16/20 ở
// PRD §4 FR2.2). `do_an_toan`/`dinh_nhom_cam` là CỔNG pass/fail (dính nhóm
// ⛔ mục 3.3 = loại thẳng bất kể điểm khác), không cộng vào tổng.
import { AXES, FORBIDDEN_TOPICS, GLOSSARY, type AxisKey } from "../../shared/engine-data";

export interface SuggestedScore {
  do_nong: number;
  do_cham: number;
  do_hop_truc: number;
  tuoi_tho: number;
  do_an_toan: number;
  dinh_nhom_cam: boolean;
  rationale: string;
}

function daysSince(dateIso: string): number {
  const ms = Date.now() - new Date(dateIso).getTime();
  return ms / (24 * 60 * 60 * 1000);
}

function countGlossaryHits(text: string, terms: string[]): number {
  const lower = text.toLowerCase();
  return terms.reduce((n, term) => (lower.includes(term.toLowerCase()) ? n + 1 : n), 0);
}

function guessAxis(text: string): AxisKey {
  let best: AxisKey = "ai";
  let bestHits = -1;
  (Object.keys(GLOSSARY) as AxisKey[]).forEach((axis) => {
    const hits = countGlossaryHits(text, GLOSSARY[axis]);
    if (hits > bestHits) {
      bestHits = hits;
      best = axis;
    }
  });
  return best;
}

/**
 * Rule-based suggestion — KHÔNG dùng LLM (v1 rule-based theo FR2.3, phần "+
 * LLM" của social backend có thể bổ sung sau khi có SOCIAL_BACKEND_URL thật).
 * Người vận hành luôn sửa tay trước khi chốt (server/routes/signals.routes.ts).
 */
export function suggestScoreForSignal(input: {
  title: string;
  rawSummary: string;
  publishedDate: string;
  truc?: string | null;
}): SuggestedScore {
  const text = `${input.title} ${input.rawSummary}`;
  const axis = (input.truc as AxisKey) && GLOSSARY[input.truc as AxisKey] ? (input.truc as AxisKey) : guessAxis(text);

  const glossaryHits = countGlossaryHits(text, GLOSSARY[axis]);
  const do_hop_truc = Math.min(5, Math.max(1, 2 + glossaryHits)); // càng nhiều từ khóa glossary khớp trục, càng dễ map

  const ageDays = daysSince(input.publishedDate);
  // Độ nóng: tín hiệu càng mới càng "nóng" (rough proxy — v1 chưa có volume/mention thật).
  const do_nong = ageDays <= 1 ? 5 : ageDays <= 3 ? 4 : ageDays <= 7 ? 3 : ageDays <= 14 ? 2 : 1;
  // Tuổi thọ: tín hiệu về sự kiện/deadline cụ thể thường ngắn hạn hơn — v1 xấp xỉ theo độ mới còn lại trong cửa sổ 14 ngày.
  const tuoi_tho = ageDays <= 3 ? 4 : ageDays <= 7 ? 3 : ageDays <= 10 ? 2 : 1;
  // Độ chạm: xấp xỉ theo mật độ từ khóa glossary trong text (proxy cho "cụ thể, đời thường").
  const do_cham = Math.min(5, Math.max(1, 1 + glossaryHits));

  const dinh_nhom_cam = FORBIDDEN_TOPICS.some((t) => text.toLowerCase().includes(t.toLowerCase()));
  const do_an_toan = dinh_nhom_cam ? 1 : 5;

  const rationale = dinh_nhom_cam
    ? `Nghi ngờ dính nhóm ⛔ (mục 3.3) — cần người vận hành xác nhận trước khi chốt điểm.`
    : `Gợi ý rule-based: trục "${AXES[axis].label}" (${glossaryHits} từ khóa glossary khớp), tín hiệu ${ageDays.toFixed(
        1
      )} ngày tuổi. Vui lòng rà soát/sửa tay trước khi chốt (FR2.3).`;

  return { do_nong, do_cham, do_hop_truc, tuoi_tho, do_an_toan, dinh_nhom_cam, rationale };
}

export function computeSignalStatus(
  scores: { do_nong: number; do_cham: number; do_hop_truc: number; tuoi_tho: number; dinh_nhom_cam: boolean },
  thresholds: { queue_min: number; idea_bank_min: number }
): { status: "queued" | "idea_bank" | "rejected"; total: number } {
  if (scores.dinh_nhom_cam) return { status: "rejected", total: 0 };
  const total = scores.do_nong + scores.do_cham + scores.do_hop_truc + scores.tuoi_tho;
  if (total >= thresholds.queue_min) return { status: "queued", total };
  if (total >= thresholds.idea_bank_min) return { status: "idea_bank", total };
  return { status: "rejected", total };
}
