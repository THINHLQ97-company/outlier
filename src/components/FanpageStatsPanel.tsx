import { ExternalLink, TrendingUp, Clock, LayoutGrid, CalendarDays } from "lucide-react";
import type { FanpageStats } from "../types";

// Số liệu của chính trang, hiện ngay trong hồ sơ thương hiệu.
//
// Vì sao không chỉ hiện tổng like: con số tuyệt đối nói rất ít. Thứ dùng được
// khi viết lại là *bài nào hơn chính trang này bao nhiêu lần* — cùng cách đo với
// điểm vượt trội của Radar. Nên mốc trung vị và bội số được cho đứng trước.

const FORMAT_LABEL: Record<string, string> = {
  text: "Chỉ chữ",
  photo: "Ảnh",
  video: "Video",
  link: "Chia sẻ link",
  other: "Khác",
};

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}tr`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function Stat({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="w-4 h-4 text-storm-500 mt-0.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <div className="text-sm font-semibold text-stone-800">{value}</div>
        <div className="text-[11px] text-stone-400">{label}</div>
      </div>
    </div>
  );
}

export default function FanpageStatsPanel({ stats }: { stats: FanpageStats }) {
  if (!stats || stats.postCount === 0) return null;

  const mix = Object.entries(stats.formatMix).sort((a, b) => b[1] - a[1]);
  // Chỉ những bài thật sự hơn hẳn mới đáng gọi là vượt trội; bài ngang mốc thì
  // không học được gì thêm so với phần còn lại của trang.
  const outliers = stats.topPosts.filter((p) => p.outperformRatio >= 1.5);

  return (
    <div className="mt-3 pt-3 border-t border-stone-200">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat
          icon={CalendarDays}
          label={`${stats.postCount} bài trong ${stats.spanDays} ngày`}
          value={`${stats.postsPerWeek} bài/tuần`}
        />
        <Stat
          icon={TrendingUp}
          label="Một bài bình thường của trang"
          value={`${compact(stats.medianLikes)} like · ${compact(stats.medianComments)} bl`}
        />
        <Stat
          icon={LayoutGrid}
          label="Định dạng hay dùng"
          value={mix.length ? `${FORMAT_LABEL[mix[0][0]] || mix[0][0]} ${Math.round(mix[0][1] * 100)}%` : "—"}
        />
        <Stat
          icon={Clock}
          label="Giờ hay đăng (giờ VN)"
          value={stats.topHours.length ? stats.topHours.map((h) => `${h.hour}h`).join(", ") : "—"}
        />
      </div>

      {mix.length > 1 && (
        <div className="flex items-center gap-1.5 mt-3 flex-wrap">
          {mix.map(([kind, ratio]) => (
            <span key={kind} className="ds-badge">
              {FORMAT_LABEL[kind] || kind} {Math.round(ratio * 100)}%
            </span>
          ))}
        </div>
      )}

      {outliers.length > 0 && (
        <div className="mt-4">
          <h4 className="text-xs font-semibold text-stone-700">
            Bài ăn hơn hẳn phần còn lại của chính trang
          </h4>
          <p className="text-[11px] text-stone-400 mt-0.5">
            So với bài trung vị của trang này, không so với trang khác. Đây là thứ đáng học giọng và
            đáng lấy làm mẫu khi viết lại.
          </p>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
            {outliers.map((p) => (
              <li key={p.id} className="flex gap-2 border border-stone-200 rounded-lg p-2">
                {p.thumbnailUrl ? (
                  <img
                    src={p.thumbnailUrl}
                    alt=""
                    className="w-14 h-14 rounded object-cover shrink-0 bg-stone-100"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-14 h-14 rounded bg-stone-100 shrink-0" aria-hidden="true" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="ds-badge ds-badge-success">×{p.outperformRatio}</span>
                    <span className="text-[11px] text-stone-400">
                      {FORMAT_LABEL[p.mediaType] || p.mediaType} · {formatDate(p.createdTime)}
                    </span>
                  </div>
                  <p className="text-xs text-stone-600 mt-1 line-clamp-2">{p.message}</p>
                  <div className="flex items-center gap-2 mt-1 text-[11px] text-stone-400 flex-wrap">
                    <span>{compact(p.likes)} like</span>
                    <span>{compact(p.comments)} bình luận</span>
                    <span>{compact(p.shares)} chia sẻ</span>
                    {p.permalink && (
                      <a
                        href={p.permalink}
                        target="_blank"
                        rel="noreferrer"
                        className="text-storm-700 hover:underline inline-flex items-center gap-0.5"
                      >
                        Xem bài <ExternalLink className="w-3 h-3" aria-hidden="true" />
                      </a>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
