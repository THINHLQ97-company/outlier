import { useEffect, useState } from "react";
import { Loader2, Wallet, AlertTriangle, TrendingUp } from "lucide-react";
import { authHeaders } from "../services/http";
import { useAppContext } from "../AppContext";
import BudgetSettings from "../components/BudgetSettings";

// Chi phí dịch vụ ngoài.
//
// Đặt ngân sách lên trước tổng tiền: câu hỏi thật của người dùng không phải "đã
// tiêu bao nhiêu" mà là "hôm nay còn quét được nữa không".

interface CostSummary {
  today: { items: number; costUsd: number; runs: number };
  month: { items: number; costUsd: number; runs: number };
  dailyBudget: { limit: number; used: number; remaining: number };
  byKind: { kind: string; items: number; costUsd: number; runs: number }[];
  daily: { day: string; items: number; costUsd: number }[];
  recent: { day: string; actorId: string; kind: string | null; items: number; costUsd: string | null; note: string | null; createdAt: string }[];
  kindLabels: Record<string, string>;
}

function usd(n: number): string {
  return `${n.toFixed(n < 0.1 ? 4 : 2)} đô`;
}

function formatDay(day: string): string {
  const [y, m, d] = day.split("-");
  return `${d}/${m}`;
}

export default function Costs() {
  // Chỉ quản trị viên mới thấy ô chỉnh trần — ai cũng xem được mình đã tiêu bao
  // nhiêu, nhưng nâng trần là quyết định của người chịu trách nhiệm chi phí.
  const { isAdmin } = useAppContext();
  const [data, setData] = useState<CostSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/costs", { headers: authHeaders(false) })
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Không tải được.");
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e?.message || "Không tải được số liệu."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="ds-card">
        <div className="flex items-center justify-center py-16 text-stone-400 gap-2">
          <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> Đang tải...
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div role="alert" className="ds-alert ds-alert-danger">
        {error || "Không có dữ liệu."}
      </div>
    );
  }

  const { dailyBudget: budget } = data;
  const usedPct = budget.limit > 0 ? Math.min(100, Math.round((budget.used / budget.limit) * 100)) : 0;
  const maxDaily = Math.max(1, ...data.daily.map((d) => d.costUsd));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-bold text-stone-800 font-display flex items-center gap-2">
          <Wallet className="w-5 h-5 text-storm-500" aria-hidden="true" /> Chi phí
        </h1>
        <p className="text-sm text-stone-500">
          Tiền trả cho dịch vụ quét ngoài (Apify). Google Trends, quét fanpage của bạn qua Meta, và bình luận
          YouTube đều <strong>miễn phí</strong> nên không xuất hiện ở đây.
        </p>
      </div>

      {isAdmin && <BudgetSettings />}

      {/* Ngân sách đứng đầu: đây mới là câu hỏi người dùng thật sự cần trả lời. */}
      <div className="ds-card">
        <div className="ds-card-body">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <h2 className="font-bold text-stone-800">Ngân sách hôm nay</h2>
            <span className="text-sm text-stone-500">
              còn <strong className="text-stone-800">{budget.remaining}</strong> / {budget.limit} lượt kết quả
            </span>
          </div>
          <div className="mt-2 h-2.5 rounded-full bg-stone-200 overflow-hidden">
            <div
              className={`h-full transition-all ${usedPct >= 90 ? "bg-red-500" : usedPct >= 70 ? "bg-amber-500" : "bg-storm-500"}`}
              style={{ width: `${usedPct}%` }}
            />
          </div>
          <p className="text-xs text-stone-400 mt-1.5">
            Đã dùng {budget.used} lượt ({usedPct}%). Hết ngân sách thì các lệnh quét tốn tiền bị chặn tới hết ngày, còn
            việc miễn phí vẫn chạy bình thường.
          </p>
          {usedPct >= 90 && (
            <div className="ds-alert ds-alert-warning mt-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
              <span className="text-xs">Sắp hết ngân sách ngày. Cân nhắc để dành cho việc quan trọng hơn.</span>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="ds-card">
          <div className="ds-card-body">
            <p className="text-xs text-stone-400">Hôm nay</p>
            <p className="text-2xl font-bold text-stone-800 font-display">{usd(data.today.costUsd)}</p>
            <p className="text-xs text-stone-400 mt-0.5">
              {data.today.runs} lượt quét · {data.today.items} kết quả
            </p>
          </div>
        </div>
        <div className="ds-card">
          <div className="ds-card-body">
            <p className="text-xs text-stone-400">Tháng này</p>
            <p className="text-2xl font-bold text-stone-800 font-display">{usd(data.month.costUsd)}</p>
            <p className="text-xs text-stone-400 mt-0.5">
              {data.month.runs} lượt quét · {data.month.items} kết quả
            </p>
          </div>
        </div>
      </div>

      {data.byKind.length > 0 && (
        <div className="ds-card">
          <div className="ds-card-body">
            <h2 className="font-bold text-stone-800">Tiền đi vào đâu (tháng này)</h2>
            <ul className="flex flex-col gap-2 mt-3">
              {data.byKind.map((k) => {
                const pct = data.month.costUsd > 0 ? Math.round((k.costUsd / data.month.costUsd) * 100) : 0;
                return (
                  <li key={k.kind}>
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-stone-700">{data.kindLabels[k.kind] || k.kind}</span>
                      <span className="text-stone-500">
                        {usd(k.costUsd)} <span className="text-stone-400">· {k.runs} lượt</span>
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-stone-100 overflow-hidden">
                      <div className="h-full bg-storm-400" style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      {data.daily.length > 0 && (
        <div className="ds-card">
          <div className="ds-card-body">
            <h2 className="font-bold text-stone-800 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-storm-500" aria-hidden="true" /> 14 ngày gần nhất
            </h2>
            <div className="flex items-end gap-1 mt-3 h-24">
              {data.daily.map((d) => (
                <div key={d.day} className="flex-1 flex flex-col items-center gap-1 min-w-0" title={`${d.day}: ${usd(d.costUsd)}`}>
                  <div
                    className="w-full bg-storm-400 rounded-t"
                    style={{ height: `${Math.max(2, (d.costUsd / maxDaily) * 80)}px` }}
                  />
                  <span className="text-[9px] text-stone-400 truncate w-full text-center">{formatDay(d.day)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="ds-card">
        <div className="ds-card-body">
          <h2 className="font-bold text-stone-800">Các lượt quét gần nhất</h2>
          {data.recent.length === 0 ? (
            <p className="text-sm text-stone-400 mt-2">Chưa có lượt quét tốn tiền nào.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-stone-100 mt-2">
              {data.recent.map((r, i) => (
                <li key={i} className="flex items-center justify-between gap-3 py-2 text-xs">
                  <div className="min-w-0">
                    <span className="text-stone-700">{data.kindLabels[r.kind || "other"] || r.kind}</span>
                    {r.note && <span className="text-stone-400"> · {r.note}</span>}
                    <div className="text-[11px] text-stone-400 truncate">{r.actorId}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-medium text-stone-700">{usd(Number(r.costUsd) || 0)}</div>
                    <div className="text-[11px] text-stone-400">{r.items} kết quả</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
