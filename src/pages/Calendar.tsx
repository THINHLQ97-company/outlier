import { useEffect, useMemo, useState } from "react";
import { Loader2, CalendarDays, CheckCircle2 } from "lucide-react";
import { getCalendar, type CalendarPost } from "../services/posts";
import { imageDisplayUrl } from "../services/http";
import { AXES, type AxisKey } from "../../shared/engine-data";

// Content calendar (PRD đề xuất thêm): lịch tuần + giám sát tỉ lệ 3 trục
// 50/30/20 (mục 3.1 v3.md) để nội dung không bị lệch trục.
const STATUS_LABEL: Record<string, string> = {
  draft: "Nháp",
  cho_duyet: "Chờ duyệt",
  sua_thoai: "Sửa thoại",
  rot: "Rớt",
  san_sang_dang: "Sẵn sàng đăng",
  da_dang: "Đã đăng",
};

// Thứ 2 đầu tuần (ISO) của 1 ngày, làm khoá nhóm tuần.
function weekStart(dateIso: string): string {
  const d = new Date(dateIso);
  const day = (d.getDay() + 6) % 7; // 0 = thứ 2
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

function fmtWeek(isoDate: string): string {
  const start = new Date(isoDate);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const f = (d: Date) => `${d.getDate()}/${d.getMonth() + 1}`;
  return `Tuần ${f(start)} – ${f(end)}/${end.getFullYear()}`;
}

export default function Calendar() {
  const [items, setItems] = useState<CalendarPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setItems(await getCalendar());
      } catch (e: any) {
        setError(e?.message || "Lỗi tải lịch nội dung.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Tỉ lệ 3 trục — tính trên bài ĐÃ ĐĂNG (những gì khán giả thật sự thấy).
  const axisStats = useMemo(() => {
    const published = items.filter((p) => p.status === "da_dang" && p.truc);
    const total = published.length;
    return (Object.keys(AXES) as AxisKey[]).map((key) => {
      const count = published.filter((p) => p.truc === key).length;
      const actual = total ? count / total : 0;
      return { key, label: AXES[key].label, target: AXES[key].ratio, actual, count };
    });
  }, [items]);

  const publishedTotal = axisStats.reduce((n, a) => n + a.count, 0);

  // Nhóm theo tuần (mốc: postedAt || decidedAt || createdAt).
  const weeks = useMemo(() => {
    const map = new Map<string, CalendarPost[]>();
    for (const p of items) {
      const anchor = p.postedAt || p.decidedAt || p.createdAt;
      const wk = weekStart(anchor);
      if (!map.has(wk)) map.set(wk, []);
      map.get(wk)!.push(p);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)); // tuần mới nhất trước
  }, [items]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-stone-400 gap-2">
        <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> Đang tải...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-bold text-stone-800 font-display flex items-center gap-2">
          <CalendarDays className="w-5 h-5 text-storm-600" aria-hidden="true" /> Lịch nội dung
        </h1>
        <p className="text-sm text-stone-500">Giám sát tỉ lệ 3 trục 50/30/20 (mục 3.1) + lịch bài theo tuần.</p>
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      {/* Giám sát tỉ lệ 3 trục (trên bài đã đăng) */}
      <div className="bg-white border border-stone-200 rounded-xl p-4">
        <h2 className="text-sm font-semibold text-stone-700 mb-3">
          Cân bằng 3 trục — {publishedTotal} bài đã đăng
        </h2>
        {publishedTotal === 0 ? (
          <p className="text-sm text-stone-400">Chưa có bài đã đăng để tính tỉ lệ.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {axisStats.map((a) => {
              const actualPct = Math.round(a.actual * 100);
              const targetPct = Math.round(a.target * 100);
              const skew = a.actual - a.target;
              const onTrack = Math.abs(skew) <= 0.1; // lệch ≤ 10 điểm % coi là ổn
              return (
                <div key={a.key} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-stone-700">{a.label}</span>
                    <span className={onTrack ? "text-stone-500" : "text-amber-700 font-medium"}>
                      {actualPct}% <span className="text-stone-400">/ mục tiêu {targetPct}%</span> ({a.count} bài)
                    </span>
                  </div>
                  <div className="relative h-2.5 bg-stone-100 rounded-full overflow-hidden">
                    {/* mốc mục tiêu */}
                    <div className="absolute top-0 bottom-0 w-0.5 bg-stone-400/70 z-10" style={{ left: `${targetPct}%` }} aria-hidden="true" />
                    <div
                      className={`h-full rounded-full ${onTrack ? "bg-storm-500" : "bg-amber-500"}`}
                      style={{ width: `${actualPct}%` }}
                    />
                  </div>
                </div>
              );
            })}
            <p className="text-[11px] text-stone-400 mt-1">
              Vạch xám = mục tiêu. Thanh cam = thực tế; chuyển hổ phách nếu lệch quá 10 điểm %.
            </p>
          </div>
        )}
      </div>

      {/* Lịch theo tuần */}
      {weeks.length === 0 ? (
        <p className="text-sm text-stone-400">Chưa có bài nào trong lịch.</p>
      ) : (
        weeks.map(([wk, posts]) => (
          <div key={wk}>
            <h2 className="text-sm font-semibold text-stone-600 mb-2">
              {fmtWeek(wk)} <span className="text-stone-400 font-normal">· {posts.length} bài</span>
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {posts.map((p) => (
                <div key={p.id} className="bg-white border border-stone-200 rounded-lg p-2.5 flex gap-2.5">
                  {p.finalImageUrl ? (
                    <img src={imageDisplayUrl(p.finalImageUrl) || undefined} alt="" className="w-14 h-14 rounded-md object-cover bg-stone-100 shrink-0" />
                  ) : (
                    <div className="w-14 h-14 rounded-md bg-stone-100 shrink-0" aria-hidden="true" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {p.truc && AXES[p.truc as AxisKey] && (
                        <span className="text-[10px] font-medium text-storm-700 bg-storm-50 px-1.5 py-0.5 rounded">
                          {AXES[p.truc as AxisKey].label}
                        </span>
                      )}
                      <span className="text-[10px] text-stone-500 inline-flex items-center gap-0.5">
                        {p.status === "da_dang" && <CheckCircle2 className="w-3 h-3 text-green-600" aria-hidden="true" />}
                        {STATUS_LABEL[p.status] || p.status}
                      </span>
                    </div>
                    <p className="text-xs text-stone-600 line-clamp-2 mt-1">{p.caption || "(không có caption)"}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
