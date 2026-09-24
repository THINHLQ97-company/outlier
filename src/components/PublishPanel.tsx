import { useEffect, useState } from "react";
import { Loader2, Send, ExternalLink, Clock, CheckCircle2, AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import { listPublishTargets, publishRemake, type PublishTarget } from "../services/remakes";
import type { PublishedRecord } from "../types";

// Đăng bản viết lên fanpage.
//
// Chỉ liệt kê trang đã nối Meta trong hồ sơ thương hiệu — người dùng không nhập
// được page id tuỳ ý, nên không đăng nhầm lên trang người khác.
//
// Hẹn giờ do chính Facebook giữ, không phải công cụ tự canh giờ rồi gọi: app có
// thể đang tắt đúng lúc đó, còn Facebook thì không.

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "short" });
}

/** Mặc định gợi ý 30 phút sau — thoả yêu cầu tối thiểu 10 phút của Facebook. */
function defaultScheduleValue(): string {
  const d = new Date(Date.now() + 30 * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function PublishPanel({
  remakeId,
  hasDraft,
  hasImage,
  published,
  onChanged,
}: {
  remakeId: string;
  hasDraft: boolean;
  hasImage: boolean;
  published?: PublishedRecord[];
  onChanged: () => void;
}) {
  const [targets, setTargets] = useState<PublishTarget[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useSchedule, setUseSchedule] = useState(false);
  const [scheduleAt, setScheduleAt] = useState(defaultScheduleValue);

  useEffect(() => {
    listPublishTargets(remakeId)
      .then((r) => {
        setTargets(r.targets);
        setNote(r.note || null);
        if (r.targets.length === 1) setSelected(r.targets[0].fanpageId);
      })
      .catch((e) => setError(e?.message || "Không tải được danh sách trang."));
  }, [remakeId]);

  async function handlePublish(force = false) {
    if (!selected) return;
    const target = targets.find((t) => t.fanpageId === selected);
    const when = useSchedule ? new Date(scheduleAt) : null;
    const confirmMsg = when
      ? `Hẹn đăng lên "${target?.pageName}" lúc ${when.toLocaleString("vi-VN")}?`
      : `Đăng ngay lên "${target?.pageName}"?`;
    if (!confirm(confirmMsg)) return;

    setBusy(true);
    setError(null);
    try {
      await publishRemake(remakeId, selected, {
        scheduledAt: when ? when.toISOString() : undefined,
        force,
      });
      onChanged();
    } catch (e: any) {
      // Đã đăng rồi thì hỏi có muốn đăng lại không, thay vì chặn cứng.
      if (/đã đăng lên/.test(e?.message || "") && !force) {
        if (confirm(`${e.message}\n\nVẫn muốn đăng thêm lần nữa?`)) {
          await handlePublish(true);
          return;
        }
      } else {
        setError(e?.message || "Không đăng được bài.");
      }
    } finally {
      setBusy(false);
    }
  }

  const doneList = published || [];

  return (
    <div className="ds-card">
      <div className="ds-card-body">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <h3 className="font-bold text-stone-800 flex items-center gap-2">
            <Send className="w-4 h-4 text-storm-500" aria-hidden="true" />
            Đăng lên fanpage
          </h3>
          {!hasImage && hasDraft && (
            <p className="text-xs text-amber-700">Chưa có ảnh — bài sẽ đăng dạng chỉ chữ.</p>
          )}
        </div>

        {doneList.length > 0 && (
          <ul className="flex flex-col gap-1.5 mt-3">
            {doneList.map((p) => (
              <li
                key={p.postId}
                className="flex items-center gap-2 text-xs bg-green-50 border border-green-200 rounded-lg px-2.5 py-2"
              >
                {p.scheduled ? (
                  <Clock className="w-3.5 h-3.5 text-green-700 shrink-0" aria-hidden="true" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-700 shrink-0" aria-hidden="true" />
                )}
                <span className="text-green-900 min-w-0 flex-1">
                  {p.scheduled ? "Đã hẹn đăng lên" : "Đã đăng lên"} <strong>{p.pageName}</strong>
                  {p.scheduled && p.scheduledFor ? ` lúc ${formatDateTime(p.scheduledFor)}` : ""}
                  {!p.scheduled ? ` · ${formatDateTime(p.publishedAt)}` : ""}
                </span>
                <a
                  href={p.permalink}
                  target="_blank"
                  rel="noreferrer"
                  className="text-green-700 hover:underline inline-flex items-center gap-0.5 shrink-0"
                >
                  Xem bài <ExternalLink className="w-3 h-3" aria-hidden="true" />
                </a>
              </li>
            ))}
          </ul>
        )}

        {!hasDraft ? (
          <p className="text-sm text-stone-500 mt-3">Viết xong rồi mới đăng được.</p>
        ) : targets.length === 0 ? (
          <div className="ds-empty mt-3">
            <p className="ds-empty-desc">{note || "Chưa trang nào nối Meta."}</p>
            <Link to="/brands" className="ds-btn ds-btn-primary ds-btn-sm mt-1">
              Sang Thương hiệu để nối trang
            </Link>
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <label htmlFor={`target-${remakeId}`} className="text-xs font-medium text-stone-600">
                Đăng lên
              </label>
              <select
                id={`target-${remakeId}`}
                className="ds-input w-auto"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                <option value="">— chọn trang —</option>
                {targets.map((t) => (
                  <option key={t.fanpageId} value={t.fanpageId}>
                    {t.pageName}
                  </option>
                ))}
              </select>
            </div>

            <label className="flex items-center gap-2 text-xs text-stone-600">
              <input
                type="checkbox"
                checked={useSchedule}
                onChange={(e) => setUseSchedule(e.target.checked)}
                className="accent-storm-600"
              />
              Hẹn giờ đăng
            </label>

            {useSchedule && (
              <div>
                <input
                  type="datetime-local"
                  className="ds-input w-auto"
                  value={scheduleAt}
                  onChange={(e) => setScheduleAt(e.target.value)}
                  aria-label="Thời điểm đăng"
                />
                <p className="text-[11px] text-stone-400 mt-1">
                  Facebook giữ bài và tự đăng — yêu cầu cách hiện tại ít nhất 10 phút. Công cụ không cần bật lúc đó.
                </p>
              </div>
            )}

            <div>
              <button
                type="button"
                onClick={() => handlePublish()}
                disabled={busy || !selected}
                className="ds-btn ds-btn-primary"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Send className="w-4 h-4" aria-hidden="true" />}
                {useSchedule ? "Hẹn đăng" : "Đăng ngay"}
              </button>
            </div>
          </div>
        )}

        {error && (
          <div role="alert" className="ds-alert ds-alert-danger mt-3">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </div>
  );
}
