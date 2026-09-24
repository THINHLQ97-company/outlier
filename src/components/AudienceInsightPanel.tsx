import { useEffect, useState } from "react";
import { Loader2, MessageSquare, HelpCircle, ShieldAlert, Lightbulb, AlertTriangle, Coins } from "lucide-react";
import { estimateCommentCost, type CommentCostEstimate } from "../services/deconstruct";
import type { AudienceInsight } from "../types";

// Người xem bài gốc quan tâm gì.
//
// Đặt số lượng lên trước tên cụm: "42 bình luận nói về giá" khác hẳn "3 bình
// luận nói về giá", mà nếu chỉ hiện tên cụm thì hai thứ trông y như nhau.

const SENTIMENT_CLS: Record<string, string> = {
  "tích cực": "ds-badge-success",
  "tiêu cực": "ds-badge-danger",
  "lẫn lộn": "ds-badge-warning",
  "trung tính": "",
};

export default function AudienceInsightPanel({
  deconstructionId,
  insight,
  commentsFetchedAt,
  platform,
  busy,
  onFetch,
  error,
}: {
  deconstructionId: string;
  insight?: AudienceInsight | null;
  commentsFetchedAt?: string | null;
  platform?: string | null;
  busy: boolean;
  onFetch: (limit: number) => void;
  error?: string | null;
}) {
  const [limit, setLimit] = useState(100);

  // Giá hỏi thẳng máy chủ chứ không tự nhân ở giao diện: đơn giá và ngân sách
  // nằm ở máy chủ, tính lại ở đây là có hai nguồn sự thật, rồi lệch nhau.
  const [estimate, setEstimate] = useState<CommentCostEstimate | null>(null);
  useEffect(() => {
    let alive = true;
    estimateCommentCost(deconstructionId, limit)
      .then((e) => alive && setEstimate(e))
      .catch(() => alive && setEstimate(null));
    return () => {
      alive = false;
    };
  }, [deconstructionId, limit]);

  return (
    <div className="ds-card">
      <div className="ds-card-body">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <h3 className="font-bold text-stone-800 flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-storm-500" aria-hidden="true" />
            Người đọc quan tâm gì
          </h3>
          <p className="text-xs text-stone-400">
            Bóc cấu trúc cho biết bài được dựng thế nào; phần này cho biết nó chạm vào đâu.
          </p>
        </div>

        {!insight ? (
          <div className="mt-3">
            <p className="text-sm text-stone-500">Chưa đọc bình luận của bài này.</p>

            {/* Giá phải hiện TRƯỚC khi bấm, và phải là con số thật từ máy chủ. */}
            {estimate && (
              <div
                className={`mt-2 rounded-lg border px-3 py-2 text-xs ${
                  estimate.free
                    ? "bg-green-50 border-green-200 text-green-900"
                    : estimate.overBudget
                    ? "bg-red-50 border-red-200 text-red-900"
                    : "bg-amber-50 border-amber-200 text-amber-900"
                }`}
              >
                <div className="flex items-center gap-1.5 font-medium">
                  <Coins className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  {estimate.free ? "Miễn phí" : `Tối đa ${estimate.maxCostUsd.toFixed(3)} đô`}
                </div>
                <p className="mt-1">{estimate.note}</p>
                {estimate.budget && !estimate.free && (
                  <p className="mt-1">
                    Ngân sách hôm nay còn <strong>{estimate.budget.remaining}</strong>/{estimate.budget.limit} lượt · đã
                    tiêu {estimate.spentToday?.toFixed(3)} đô.
                    {estimate.overBudget && " Không đủ ngân sách cho lần quét này."}
                  </p>
                )}
              </div>
            )}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <label htmlFor="cmt-limit" className="text-xs text-stone-600">
                Số bình luận
              </label>
              <select
                id="cmt-limit"
                className="ds-input w-auto"
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
              >
                {[50, 100, 200, 300].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => onFetch(limit)}
                disabled={busy || estimate?.unsupported || estimate?.overBudget}
                className="ds-btn ds-btn-primary ds-btn-sm"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : null}
                Đọc bình luận và phân tích
              </button>
            </div>
            {busy && <p className="text-xs text-stone-400 mt-2">Đang lấy bình luận rồi đọc — mất khoảng 30–90 giây…</p>}
          </div>
        ) : (
          <div className="mt-3">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="ds-badge">{insight.sampleSize} bình luận đã đọc</span>
              {commentsFetchedAt && (
                <span className="text-[11px] text-stone-400">
                  {new Date(commentsFetchedAt).toLocaleDateString("vi-VN")}
                </span>
              )}
              <button type="button" onClick={() => onFetch(limit)} disabled={busy} className="ds-btn ds-btn-ghost ds-btn-sm">
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : null}
                Đọc lại
              </button>
            </div>

            {insight.warning && (
              <div className="ds-alert ds-alert-warning mt-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                <span className="text-xs">{insight.warning}</span>
              </div>
            )}

            {insight.themes.length > 0 && (
              <ul className="flex flex-col gap-2 mt-3">
                {insight.themes.map((t) => (
                  <li key={t.label} className="border border-stone-200 rounded-lg p-2.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* Số đứng trước tên: nó là thứ quyết định cụm này có đáng bận tâm không. */}
                      <span className="text-sm font-bold text-storm-700">{t.count}</span>
                      <span className="text-sm font-semibold text-stone-800">{t.label}</span>
                      {t.sentiment && (
                        <span className={`ds-badge ${SENTIMENT_CLS[t.sentiment] || ""}`}>{t.sentiment}</span>
                      )}
                    </div>
                    {t.quotes.length > 0 && (
                      <ul className="mt-1.5 flex flex-col gap-1">
                        {t.quotes.map((q, i) => (
                          <li key={i} className="text-xs text-stone-500 border-l-2 border-stone-200 pl-2 italic">
                            “{q}”
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {insight.questions.length > 0 && (
              <div className="mt-3">
                <h4 className="text-xs font-semibold text-stone-700 flex items-center gap-1.5">
                  <HelpCircle className="w-3.5 h-3.5 text-storm-500" aria-hidden="true" />
                  Câu hỏi lặp đi lặp lại
                </h4>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {insight.questions.map((q, i) => (
                    <li key={i} className="text-xs text-stone-600">
                      · {q}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {insight.objections.length > 0 && (
              <div className="mt-3">
                <h4 className="text-xs font-semibold text-stone-700 flex items-center gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5 text-amber-600" aria-hidden="true" />
                  Họ phản đối / nghi ngờ điều gì
                </h4>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {insight.objections.map((o, i) => (
                    <li key={i} className="text-xs text-stone-600">
                      · {o}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {insight.remakeAngles.length > 0 && (
              <div className="mt-3 bg-storm-50 border border-storm-200 rounded-lg p-2.5">
                <h4 className="text-xs font-semibold text-storm-800 flex items-center gap-1.5">
                  <Lightbulb className="w-3.5 h-3.5" aria-hidden="true" />
                  Góc nên làm tiếp
                </h4>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {insight.remakeAngles.map((a, i) => (
                    <li key={i} className="text-xs text-storm-900">
                      · {a}
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] text-storm-700 mt-1.5">
                  Bấm “Remake bài viết” ở trên — phần này sẽ được đưa vào để bản viết bám đúng mối quan tâm của người đọc.
                </p>
              </div>
            )}
          </div>
        )}

        {error && (
          <div role="alert" className="ds-alert ds-alert-danger mt-3">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
