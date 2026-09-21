import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Plus,
  X,
  Loader2,
  Trash2,
  ExternalLink,
  AlertTriangle,
  RefreshCw,
  Eye,
  Heart,
  MessageCircle,
  Share2,
  Users,
  Info,
  Flame,
  Scissors,
  Clock,
  DollarSign,
  Image as ImageIcon,
} from "lucide-react";
import {
  listChannels,
  addChannel,
  refreshChannel,
  getChannelItems,
  deleteChannel,
  pollChannel,
  ChannelPaidRequiredError,
  DuplicateChannelError,
  type AddChannelInput,
} from "../services/channels";
import ConfirmDialog from "../components/ConfirmDialog";
import type { WatchedChannel, WatchedChannelDetail, RadarItem, RadarConfidence, RadarMetricsSource } from "../types";

// Trang "Kênh theo dõi" — thêm kênh đối thủ rồi mỗi ngày bấm "Làm mới" để xem
// họ vừa đăng gì và bài nào đang bật (docs/PRD.md §4 J2). LINH HỒN màn này:
// ĐÁNH DẤU BÀI MỚI so với lần xem trước — đó là lý do người dùng theo dõi một
// kênh thay vì quét rời ở Radar. Quy trình theo dõi tiến độ khi làm mới dùng
// lại nguyên cơ chế poll của Radar (services/channels.ts::pollChannel, port
// từ pollRadarJob).
const PLATFORM_LABEL: Record<string, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  douyin: "Douyin",
};

const CONFIDENCE_META: Record<RadarConfidence, { label: string; cls: string }> = {
  low: { label: "Tham khảo", cls: "bg-amber-50 text-amber-700 border border-amber-200" },
  medium: { label: "Khá chắc", cls: "bg-blue-50 text-blue-700 border border-blue-200" },
  high: { label: "Đáng tin", cls: "bg-green-50 text-green-700 border border-green-200" },
};

const SOURCE_META: Record<RadarMetricsSource, { label: string; cls: string }> = {
  scan: { label: "Số liệu sơ bộ", cls: "bg-stone-100 text-stone-500" },
  apify: { label: "Số liệu đầy đủ", cls: "bg-storm-50 text-storm-700" },
};

const numberFmt = new Intl.NumberFormat("vi-VN", { notation: "compact", maximumFractionDigits: 1 });

function formatMetric(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return numberFmt.format(n);
}

function formatDuration(sec: number | null | undefined): string | null {
  if (!sec || sec <= 0) return null;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("vi-VN");
}

// Người dùng cần biết dữ liệu đang xem cũ hay mới — hiển thị dạng tương đối,
// gần giống cách Facebook/Zalo báo thời điểm.
function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "Chưa làm mới lần nào";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Chưa làm mới lần nào";
  const diffSec = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (diffSec < 60) return "Vừa xong";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} phút trước`;
  if (diffSec < 3600 * 24) return `${Math.floor(diffSec / 3600)} giờ trước`;
  const dayDiff = Math.floor(diffSec / (3600 * 24));
  if (dayDiff === 1) return "Hôm qua";
  if (dayDiff < 7) return `${dayDiff} ngày trước`;
  return d.toLocaleDateString("vi-VN");
}

export default function Channels() {
  const [channels, setChannels] = useState<WatchedChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<WatchedChannelDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<WatchedChannel | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Theo dõi kênh đang làm mới (chạy nền ở backend) — port nguyên cơ chế từ
  // Radar.tsx: ref cho hàm huỷ để cleanup chắc chắn, đếm giây riêng để hiện
  // "đang quét... (Ns)".
  const stopPollRef = useRef<(() => void) | null>(null);
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [watchElapsedSec, setWatchElapsedSec] = useState(0);
  const [watchTimedOut, setWatchTimedOut] = useState(false);

  async function reloadList() {
    setLoading(true);
    setListError(null);
    try {
      setChannels(await listChannels());
    } catch (e: any) {
      setListError(e?.message || "Lỗi tải danh sách kênh.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reloadList();
  }, []);

  function stopWatching() {
    if (stopPollRef.current) {
      stopPollRef.current();
      stopPollRef.current = null;
    }
    if (tickTimerRef.current) {
      clearInterval(tickTimerRef.current);
      tickTimerRef.current = null;
    }
  }

  function syncChannelInList(row: WatchedChannel) {
    setChannels((prev) => prev.map((c) => (c.id === row.id ? { ...c, ...row } : c)));
  }

  function startWatching(id: string) {
    stopWatching();
    setWatchTimedOut(false);
    const startedAt = Date.now();
    setWatchElapsedSec(0);
    tickTimerRef.current = setInterval(() => {
      setWatchElapsedSec(Math.round((Date.now() - startedAt) / 1000));
    }, 1000);
    stopPollRef.current = pollChannel(id, {
      onUpdate: (d) => {
        setDetail(d);
        syncChannelInList(d);
        if (d.scanStatus !== "scanning") stopWatching();
      },
      onTimeout: () => {
        setWatchTimedOut(true);
        stopWatching();
      },
      onError: (msg) => {
        setDetailError(msg);
        stopWatching();
      },
    });
  }

  // Tải bài của một kênh; nếu đang quét thì theo dõi luôn. Dùng lại cho: chọn
  // kênh khác, thêm kênh mới, và sau khi bấm "Làm mới".
  async function loadAndWatch(id: string) {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const d = await getChannelItems(id);
      setDetail(d);
      syncChannelInList(d);
      if (d.scanStatus === "scanning") startWatching(id);
    } catch (e: any) {
      setDetailError(e?.message || "Không tải được bài của kênh.");
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    setDetail(null);
    setDetailError(null);
    if (selectedId) loadAndWatch(selectedId);
    return () => stopWatching();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  async function handleRefresh(id: string) {
    setDetailError(null);
    try {
      const result = await refreshChannel(id);
      syncChannelInList(result);
      if (selectedId === id) {
        setDetail((prev) => (prev ? { ...prev, ...result } : prev));
        startWatching(id);
      }
    } catch (e: any) {
      setDetailError(e?.message || "Không làm mới được kênh.");
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteChannel(deleteTarget.id);
      setChannels((prev) => prev.filter((c) => c.id !== deleteTarget.id));
      if (selectedId === deleteTarget.id) setSelectedId(null);
      setDeleteTarget(null);
    } catch (e: any) {
      setListError(e?.message || "Xoá kênh thất bại.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-stone-800 font-display">Kênh theo dõi</h1>
          <p className="text-sm text-stone-500">
            Thêm kênh đối thủ vào danh sách, rồi bấm "Làm mới" mỗi ngày để xem họ vừa đăng gì — bài mới sẽ được đánh dấu rõ.
          </p>
        </div>
        <button
          onClick={() => setShowAddForm(true)}
          className="flex items-center gap-1.5 text-sm font-medium text-white bg-storm-600 hover:bg-storm-700 px-3 py-2 rounded-lg transition-colors shrink-0"
        >
          <Plus className="w-4 h-4" aria-hidden="true" /> Thêm kênh
        </button>
      </div>

      {listError && (
        <div role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {listError}
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-4 items-start">
        <aside className="w-full lg:w-72 shrink-0 flex flex-col gap-2">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-stone-400 gap-2">
              <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> Đang tải...
            </div>
          ) : channels.length === 0 ? (
            <div className="text-center py-10 text-stone-400 text-sm border border-dashed border-stone-300 rounded-xl">
              Chưa theo dõi kênh nào. Bấm "Thêm kênh" để bắt đầu.
            </div>
          ) : (
            channels.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={`text-left rounded-xl border px-3 py-2.5 transition-colors ${
                  selectedId === c.id ? "border-storm-400 bg-storm-50" : "border-stone-200 bg-white hover:border-stone-300"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold text-stone-800 truncate block min-w-0">
                    {c.channelName || c.channelUrl}
                  </span>
                  {c.lastNewCount > 0 && (
                    <span className="shrink-0 flex items-center gap-1 text-[10px] font-bold text-white bg-storm-600 px-1.5 py-0.5 rounded-full">
                      <Flame className="w-2.5 h-2.5" aria-hidden="true" /> {c.lastNewCount} mới
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap mt-1">
                  <span className="text-[10px] text-stone-400">{PLATFORM_LABEL[c.platform] || c.platform}</span>
                  {c.followerCount != null && (
                    <span className="text-[10px] text-stone-400 flex items-center gap-0.5">
                      <Users className="w-2.5 h-2.5" aria-hidden="true" /> {formatMetric(c.followerCount)}
                    </span>
                  )}
                  {c.scanStatus === "scanning" && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 flex items-center gap-1">
                      <Loader2 className="w-2.5 h-2.5 animate-spin" aria-hidden="true" /> Đang quét
                    </span>
                  )}
                  {c.scanStatus === "error" && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-red-50 text-red-600">Lỗi</span>
                  )}
                </div>
                <div className="text-[10px] text-stone-400 mt-1 flex items-center gap-1">
                  <Clock className="w-2.5 h-2.5" aria-hidden="true" /> {formatRelative(c.lastScanAt)}
                </div>
              </button>
            ))
          )}
        </aside>

        <div className="flex-1 min-w-0 w-full">
          {!selectedId ? (
            <div className="flex flex-col items-center justify-center text-center gap-2 py-20 text-stone-400 border border-dashed border-stone-300 rounded-2xl bg-white/50">
              <Eye className="w-8 h-8 text-stone-300" aria-hidden="true" />
              <p className="text-sm">Chọn một kênh bên trái để xem bài vừa đăng, hoặc thêm kênh mới.</p>
            </div>
          ) : detail ? (
            <>
              {detailError && (
                <div role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">
                  {detailError}
                </div>
              )}
              <ChannelDetailPanel
                key={detail.id}
                detail={detail}
                watching={detail.scanStatus === "scanning"}
                watchElapsedSec={watchElapsedSec}
                watchTimedOut={watchTimedOut}
                onRefresh={() => handleRefresh(detail.id)}
                onRequestDelete={() => setDeleteTarget(detail)}
              />
            </>
          ) : detailLoading ? (
            <div className="flex items-center justify-center py-20 text-stone-400 gap-2">
              <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> Đang tải...
            </div>
          ) : detailError ? (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{detailError}</div>
          ) : null}
        </div>
      </div>

      {showAddForm && (
        <AddChannelForm
          onClose={() => setShowAddForm(false)}
          onAdded={(row) => {
            setChannels((prev) => [row, ...prev]);
            setSelectedId(row.id);
            setShowAddForm(false);
          }}
          onSelectExisting={(id) => {
            setSelectedId(id);
            setShowAddForm(false);
          }}
        />
      )}

      <ConfirmDialog
        isOpen={!!deleteTarget}
        title="Bỏ theo dõi kênh?"
        message={`Bỏ theo dõi "${deleteTarget?.channelName || deleteTarget?.channelUrl}" cùng toàn bộ lịch sử đã quét? Không thể hoàn tác.${deleting ? " Đang xoá..." : ""}`}
        confirmText="Bỏ theo dõi"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function AddChannelForm({
  onClose,
  onAdded,
  onSelectExisting,
}: {
  onClose: () => void;
  onAdded: (row: WatchedChannel) => void;
  onSelectExisting: (id: string) => void;
}) {
  const [channelUrl, setChannelUrl] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<{ id: string; message: string } | null>(null);
  // Hộp xác nhận chi phí thật (TikTok/Instagram) — chỉ hiện khi backend từ
  // chối lần đầu vì needsPaid, không tự đoán trước.
  const [paidConfirm, setPaidConfirm] = useState<{ estimatedCostUsd: number; apifyConfigured: boolean; message: string } | null>(
    null,
  );

  async function submit(useApify: boolean) {
    setSubmitting(true);
    setError(null);
    setDuplicate(null);
    try {
      const input: AddChannelInput = { channelUrl: channelUrl.trim(), note: note.trim() || undefined, useApify };
      const result = await addChannel(input);
      onAdded(result);
    } catch (e: any) {
      if (e instanceof ChannelPaidRequiredError) {
        setPaidConfirm({ estimatedCostUsd: e.estimatedCostUsd, apifyConfigured: e.apifyConfigured, message: e.message });
      } else if (e instanceof DuplicateChannelError) {
        setDuplicate({ id: e.id, message: e.message });
      } else {
        setError(e?.message || "Thêm kênh thất bại.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!channelUrl.trim()) {
      setError("Dán link kênh muốn theo dõi.");
      return;
    }
    submit(false);
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-stone-100">
          <h3 className="font-semibold text-stone-800 font-display">Thêm kênh theo dõi</h3>
          <button
            onClick={onClose}
            disabled={submitting}
            className="p-1.5 text-stone-400 hover:bg-stone-100 rounded-full disabled:opacity-40"
            aria-label="Đóng"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-3">
          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1" htmlFor="ch-url">
              Link kênh đối thủ
            </label>
            <input
              id="ch-url"
              required
              disabled={submitting}
              type="url"
              value={channelUrl}
              onChange={(e) => setChannelUrl(e.target.value)}
              placeholder="https://youtube.com/@... hoặc tiktok.com/@..."
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm disabled:opacity-60"
            />
            <p className="text-[11px] text-stone-400 mt-1">
              Hỗ trợ YouTube, TikTok, Instagram — hệ thống tự nhận nền tảng từ link, không cần chọn tay.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1" htmlFor="ch-note">
              Ghi chú (không bắt buộc)
            </label>
            <input
              id="ch-note"
              disabled={submitting}
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Vì sao bạn theo dõi kênh này?"
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm disabled:opacity-60"
            />
          </div>

          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

          {duplicate && (
            <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 flex flex-col gap-2">
              <span>{duplicate.message}</span>
              <button
                type="button"
                onClick={() => onSelectExisting(duplicate.id)}
                className="self-start text-xs font-medium text-storm-700 hover:bg-storm-50 px-2 py-1 rounded-lg transition-colors"
              >
                Xem kênh đã theo dõi
              </button>
            </div>
          )}

          {submitting && (
            <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
              <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden="true" />
              Đang thêm kênh...
            </div>
          )}
          <button
            type="submit"
            disabled={submitting}
            className="mt-1 flex items-center justify-center gap-2 bg-storm-600 hover:bg-storm-700 text-white text-sm font-medium rounded-lg py-2.5 disabled:opacity-60"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />} {submitting ? "Đang thêm..." : "Thêm kênh"}
          </button>
        </form>
      </div>

      <ConfirmDialog
        isOpen={!!paidConfirm}
        title="Xác nhận chi phí theo dõi"
        message={
          paidConfirm
            ? paidConfirm.apifyConfigured
              ? `Kênh này (TikTok/Instagram) không lấy được bằng công cụ miễn phí. Mỗi lần làm mới sẽ tốn khoảng ${paidConfirm.estimatedCostUsd.toLocaleString(
                  "vi-VN",
                )} USD qua dịch vụ ngoài. Đây là chi phí thật. Tiếp tục theo dõi?`
              : "Kênh này cần dịch vụ có phí để lấy dữ liệu, nhưng hệ thống chưa cấu hình dịch vụ đó — chưa thể theo dõi kênh này lúc này."
            : ""
        }
        confirmText="Đồng ý, theo dõi"
        cancelText="Thôi"
        onConfirm={() => {
          if (!paidConfirm?.apifyConfigured) {
            setPaidConfirm(null);
            return;
          }
          setPaidConfirm(null);
          submit(true);
        }}
        onCancel={() => setPaidConfirm(null)}
      />
    </div>
  );
}

function ChannelDetailPanel({
  detail,
  watching,
  watchElapsedSec,
  watchTimedOut,
  onRefresh,
  onRequestDelete,
}: {
  detail: WatchedChannelDetail;
  watching: boolean;
  watchElapsedSec: number;
  watchTimedOut: boolean;
  onRefresh: () => void;
  onRequestDelete: () => void;
}) {
  // Lần lấy dữ liệu đầu tiên: nhãn "MỚI" chưa có nghĩa vì mọi bài đều mới.
  // Dùng số lần quét do backend đếm — đúng kể cả khi người dùng đổi máy.
  const isFirstScan = !!detail.lastScanAt && detail.scanCount <= 1 && !watching;

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white rounded-xl border border-stone-200 p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-stone-800 font-display truncate">
              {detail.channelName || detail.channelUrl}
            </h2>
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <span className="text-[11px] text-stone-400">{PLATFORM_LABEL[detail.platform] || detail.platform}</span>
              {detail.followerCount != null && (
                <span className="text-[11px] text-stone-400 flex items-center gap-0.5">
                  <Users className="w-3 h-3" aria-hidden="true" /> {formatMetric(detail.followerCount)} người theo dõi
                </span>
              )}
              <span className="text-[11px] text-stone-400 flex items-center gap-1">
                <Clock className="w-3 h-3" aria-hidden="true" /> {formatRelative(detail.lastScanAt)}
              </span>
              {detail.useApify && (
                <span className="text-[11px] font-medium px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 flex items-center gap-1">
                  <DollarSign className="w-3 h-3" aria-hidden="true" /> Mỗi lần làm mới tốn phí
                </span>
              )}
              <a
                href={detail.channelUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-stone-400 hover:text-storm-700 hover:underline flex items-center gap-0.5"
              >
                Xem kênh <ExternalLink className="w-3 h-3" aria-hidden="true" />
              </a>
            </div>
            {detail.note && <p className="text-xs text-stone-500 mt-1.5 italic">"{detail.note}"</p>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onRefresh}
              disabled={watching}
              className="flex items-center gap-1.5 text-sm font-medium text-white bg-storm-600 hover:bg-storm-700 px-3 py-2 rounded-lg transition-colors disabled:opacity-50"
            >
              {watching ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="w-4 h-4" aria-hidden="true" />}
              {watching ? "Đang làm mới..." : "Làm mới"}
            </button>
            <button
              onClick={onRequestDelete}
              className="flex items-center gap-1 text-xs font-medium text-red-600 hover:bg-red-50 px-2.5 py-1.5 rounded-lg transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" /> Bỏ theo dõi
            </button>
          </div>
        </div>

        {watchTimedOut ? (
          <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5 mt-2 flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
            Quá lâu không có phản hồi, thử tải lại trang.
          </div>
        ) : watching ? (
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mt-2 flex items-center gap-1.5">
            <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" aria-hidden="true" />
            Đang lấy bài mới của kênh... ({watchElapsedSec}s)
          </div>
        ) : null}

        {detail.scanStatus === "error" && detail.errorMessage && (
          <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5 mt-2 flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
            <span className="flex-1">{detail.errorMessage}</span>
            <button onClick={onRefresh} className="font-medium underline shrink-0">
              Thử lại
            </button>
          </div>
        )}

        {detail.lastNewCount > 0 && !watching && (
          <div className="text-xs text-storm-700 bg-storm-50 border border-storm-200 rounded-lg px-2.5 py-1.5 mt-2 flex items-center gap-1.5">
            <Flame className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            Có {detail.lastNewCount} bài mới kể từ lần làm mới trước.
          </div>
        )}
        {isFirstScan && (
          <div className="text-xs text-stone-400 bg-stone-50 border border-stone-200 rounded-lg px-2.5 py-1.5 mt-2 flex items-start gap-1.5">
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
            Đây là lần lấy dữ liệu đầu tiên nên chưa có gì để so sánh. Lần làm mới sau sẽ đánh dấu bài mới cho bạn.
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {detail.items.length === 0 ? (
          <div className="text-center py-14 text-stone-400 text-sm border border-dashed border-stone-300 rounded-xl bg-white/50">
            {detail.scanStatus === "scanning" ? "Đang lấy bài..." : "Chưa có bài nào. Bấm \"Làm mới\" để lấy dữ liệu."}
          </div>
        ) : (
          detail.items.map((item) => <ChannelItemCard key={item.id} item={item} />)
        )}
      </div>
    </div>
  );
}

function ChannelItemCard({ item }: { item: RadarItem }) {
  const navigate = useNavigate();
  const score = item.outperformScore != null ? (item.outperformScore / 10).toFixed(1) : null;
  const conf = CONFIDENCE_META[item.confidence];
  const src = SOURCE_META[item.metricsSource];
  const duration = formatDuration(item.durationSec);
  const reasons = item.scoreBreakdown?.reasons || [];

  return (
    <div
      className={`rounded-xl border p-4 flex flex-col sm:flex-row gap-4 transition-colors ${
        item.isNew ? "bg-storm-50/60 border-storm-300 ring-1 ring-storm-200" : "bg-white border-stone-200"
      }`}
    >
      <div className="w-full sm:w-40 shrink-0">
        <div className="relative w-full aspect-video rounded-lg overflow-hidden bg-stone-100 flex items-center justify-center">
          {item.coverUrl ? (
            <img src={item.coverUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
          ) : (
            <ImageIcon className="w-6 h-6 text-stone-300" aria-hidden="true" />
          )}
          {item.isNew && (
            <span className="absolute top-1 left-1 flex items-center gap-1 text-[10px] font-bold bg-storm-600 text-white px-1.5 py-0.5 rounded shadow-sm">
              <Flame className="w-2.5 h-2.5" aria-hidden="true" /> MỚI
            </span>
          )}
          {duration && (
            <span className="absolute bottom-1 right-1 text-[10px] font-medium bg-black/70 text-white px-1.5 py-0.5 rounded">
              {duration}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 min-w-0 flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-sm text-stone-800 hover:text-storm-700 hover:underline inline-flex items-start gap-1"
            >
              <span className="line-clamp-2">{item.title || item.url}</span>
              <ExternalLink className="w-3 h-3 shrink-0 mt-1" aria-hidden="true" />
            </a>
            <p className="text-xs text-stone-500 mt-0.5">{formatDate(item.publishedAt)}</p>
          </div>
          <div className="text-right shrink-0">
            <div className="text-2xl font-bold text-storm-700 font-display leading-none">{score ?? "—"}</div>
            <div className="text-[10px] text-stone-400 mt-0.5">/ 100 điểm</div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {item.isNew && (
            <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-storm-600 text-white flex items-center gap-1">
              <Flame className="w-3 h-3" aria-hidden="true" /> MỚI
            </span>
          )}
          <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${conf.cls}`}>{conf.label}</span>
          <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${src.cls}`}>{src.label}</span>
        </div>

        <div className="flex items-center gap-3 flex-wrap text-xs text-stone-600">
          <span className="flex items-center gap-1" title="Lượt xem">
            <Eye className="w-3.5 h-3.5 text-stone-400" aria-hidden="true" /> {formatMetric(item.views)}
          </span>
          <span className="flex items-center gap-1" title="Lượt thích">
            <Heart className="w-3.5 h-3.5 text-stone-400" aria-hidden="true" /> {formatMetric(item.likes)}
          </span>
          <span className="flex items-center gap-1" title="Bình luận">
            <MessageCircle className="w-3.5 h-3.5 text-stone-400" aria-hidden="true" /> {formatMetric(item.comments)}
          </span>
          <span className="flex items-center gap-1" title="Chia sẻ">
            <Share2 className="w-3.5 h-3.5 text-stone-400" aria-hidden="true" /> {formatMetric(item.shares)}
          </span>
          <button
            onClick={() => navigate(`/deconstruct?radarItemId=${item.id}`)}
            className="ml-auto flex items-center gap-1 text-xs font-medium text-storm-700 hover:bg-storm-50 px-2 py-1 rounded-lg transition-colors shrink-0"
            title="Phân tích vì sao bài này giữ được người xem"
          >
            <Scissors className="w-3.5 h-3.5" aria-hidden="true" /> Bóc cấu trúc
          </button>
        </div>

        {reasons.length > 0 && (
          <ul className="flex flex-col gap-1 text-xs text-stone-500 bg-stone-50 border border-stone-100 rounded-lg px-2.5 py-2">
            {reasons.map((r, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <Info className="w-3 h-3 shrink-0 mt-0.5 text-stone-300" aria-hidden="true" />
                {r}
              </li>
            ))}
          </ul>
        )}
        {item.confidence === "low" && (
          <p className="text-[11px] text-amber-700 italic">
            Kênh này chưa đủ dữ liệu để có mốc so sánh riêng nên điểm chỉ mang tính tham khảo.
          </p>
        )}
      </div>
    </div>
  );
}
