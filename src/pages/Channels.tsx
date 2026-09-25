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
  repairChannel,
  patchChannel,
} from "../services/channels";
import { imageDisplayUrl } from "../services/http";
import ConfirmDialog from "../components/ConfirmDialog";
import type { WatchedChannel, WatchedChannelDetail, RadarItem, RadarConfidence, RadarMetricsSource } from "../types";
import PlatformMark from "../components/PlatformMark";

// Trang "Kênh theo dõi" — thêm kênh đối thủ rồi mỗi ngày bấm "Làm mới" để xem
// họ vừa đăng gì và bài nào đang bật (docs/PRD.md §4 J2). LINH HỒN màn này:
// ĐÁNH DẤU BÀI MỚI so với lần xem trước — đó là lý do người dùng theo dõi một
// kênh thay vì quét rời ở Radar. Quy trình theo dõi tiến độ khi làm mới dùng
// lại nguyên cơ chế poll của Radar (services/channels.ts::pollChannel, port
// từ pollRadarJob).
const PLATFORM_LABEL: Record<string, string> = {
  facebook: "Facebook",
  tiktok: "TikTok",
  youtube: "YouTube",
  instagram: "Instagram",
  douyin: "Douyin",
};

// Thứ tự tab: đặt theo mức độ hay dùng, không theo bảng chữ cái.
const PLATFORM_ORDER = ["facebook", "tiktok", "youtube", "instagram", "douyin"];

const CONFIDENCE_META: Record<RadarConfidence, { label: string; cls: string }> = {
  low: { label: "Tham khảo", cls: "ds-badge-warning" },
  medium: { label: "Khá chắc", cls: "ds-badge-info" },
  high: { label: "Đáng tin", cls: "ds-badge-success" },
};

const SOURCE_META: Record<RadarMetricsSource, { label: string; cls: string }> = {
  scan: { label: "Số liệu sơ bộ", cls: "" },
  apify: { label: "Số liệu đầy đủ", cls: "ds-badge-primary" },
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
  // Lọc theo nền tảng. Mỗi nền tảng quét bằng đường khác nhau và chi phí khác
  // nhau, nên xem tách ra dễ quyết định hơn là trộn chung một danh sách.
  const [platformFilter, setPlatformFilter] = useState<string>("all");
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

  const visibleChannels =
    platformFilter === "all" ? channels : channels.filter((c) => c.platform === platformFilter);

  // Đếm theo nền tảng, giữ thứ tự đã định rồi mới tới những nền tảng lạ.
  const counts = new Map<string, number>();
  for (const c of channels) counts.set(c.platform, (counts.get(c.platform) || 0) + 1);
  const platformCounts = [...counts.entries()].sort(
    (a, b) => PLATFORM_ORDER.indexOf(a[0]) - PLATFORM_ORDER.indexOf(b[0]),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-stone-800 font-display">Kênh theo dõi</h1>
          <p className="text-sm text-stone-500">
            Thêm kênh đối thủ vào danh sách, rồi bấm "Làm mới" mỗi ngày để xem họ vừa đăng gì — bài mới sẽ được đánh dấu rõ.
          </p>
        </div>
        <button onClick={() => setShowAddForm(true)} className="ds-btn ds-btn-primary shrink-0">
          <Plus className="w-4 h-4" aria-hidden="true" /> Thêm kênh
        </button>
      </div>

      {listError && (
        <div role="alert" className="ds-alert ds-alert-danger">
          {listError}
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-4 items-start">
        <aside className="w-full lg:w-72 shrink-0 flex flex-col gap-2">
          {loading ? (
            <div className="ds-card">
              <div className="flex items-center justify-center py-10 text-stone-400 gap-2">
                <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> Đang tải...
              </div>
            </div>
          ) : channels.length === 0 ? (
            <div className="ds-card">
              <div className="ds-empty">
                <div className="ds-empty-icon">
                  <Eye className="w-8 h-8" aria-hidden="true" />
                </div>
                <p className="ds-empty-title">Chưa theo dõi kênh nào</p>
                <p className="ds-empty-desc">Thêm kênh đối thủ để mỗi ngày xem họ vừa đăng gì.</p>
                <button onClick={() => setShowAddForm(true)} className="ds-btn ds-btn-primary ds-btn-sm mt-1">
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Thêm kênh
                </button>
              </div>
            </div>
          ) : (
            visibleChannels.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={`text-left rounded-xl border px-3 py-2.5 transition-colors ${
                  selectedId === c.id ? "border-storm-400 bg-storm-50" : "border-stone-200 bg-white hover:border-stone-300"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="flex items-center gap-2 min-w-0">
                    {c.channelAvatarUrl ? (
                      <img
                        src={c.channelAvatarUrl}
                        alt=""
                        className="w-7 h-7 rounded-full object-cover bg-stone-100 shrink-0"
                        loading="lazy"
                      />
                    ) : (
                      <span className="w-7 h-7 rounded-full bg-stone-100 shrink-0 flex items-center justify-center">
                        <PlatformMark platform={c.platform} className="w-4 h-4" />
                      </span>
                    )}
                    <span className="text-sm font-semibold text-stone-800 truncate block min-w-0">
                      {c.channelName || c.channelUrl}
                    </span>
                  </span>
                  {c.lastNewCount > 0 && (
                    <span className="shrink-0 flex items-center gap-1 text-[10px] font-bold text-white bg-storm-600 px-1.5 py-0.5 rounded-full">
                      <Flame className="w-2.5 h-2.5" aria-hidden="true" /> {c.lastNewCount} mới
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap mt-1">
                  <span className="inline-flex items-center gap-1 text-[10px] text-stone-400">
                    <PlatformMark platform={c.platform} className="w-3 h-3" />
                    {PLATFORM_LABEL[c.platform] || c.platform}
                  </span>
                  {c.followerCount != null && (
                    <span className="text-[10px] text-stone-400 flex items-center gap-0.5">
                      <Users className="w-2.5 h-2.5" aria-hidden="true" /> {formatMetric(c.followerCount)}
                    </span>
                  )}
                  {c.scanStatus === "scanning" && (
                    <span className="ds-badge ds-badge-warning">
                      <Loader2 className="w-2.5 h-2.5 animate-spin" aria-hidden="true" /> Đang quét
                    </span>
                  )}
                  {c.scanStatus === "error" && <span className="ds-badge ds-badge-danger">Lỗi</span>}
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
            <div className="ds-card">
              <div className="ds-empty">
                <div className="ds-empty-icon">
                  <Eye className="w-8 h-8" aria-hidden="true" />
                </div>
                <p className="ds-empty-title">Chưa chọn kênh</p>
                <p className="ds-empty-desc">Chọn một kênh bên trái để xem bài vừa đăng, hoặc thêm kênh mới.</p>
              </div>
            </div>
          ) : detail ? (
            <>
              {detailError && (
                <div role="alert" className="ds-alert ds-alert-danger mb-3">
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
            <div className="ds-card">
              <div className="flex items-center justify-center py-20 text-stone-400 gap-2">
                <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> Đang tải...
              </div>
            </div>
          ) : detailError ? (
            <div role="alert" className="ds-alert ds-alert-danger">{detailError}</div>
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
    <div className="ds-modal-overlay open" style={{ zIndex: 100 }}>
      <div className="ds-modal max-h-[90vh] overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="add-channel-title">
        <div className="ds-modal-header">
          <h3 id="add-channel-title" className="ds-modal-title font-display">
            Thêm kênh theo dõi
          </h3>
          <button onClick={onClose} disabled={submitting} className="ds-modal-close disabled:opacity-40" aria-label="Đóng">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="ds-modal-body flex flex-col gap-3">
          <div>
            <label className="ds-label" htmlFor="ch-url">
              Link kênh đối thủ
            </label>
            <input
              id="ch-url"
              required
              disabled={submitting}
              type="url"
              value={channelUrl}
              onChange={(e) => setChannelUrl(e.target.value)}
              placeholder="https://facebook.com/tenpage, youtube.com/@..., tiktok.com/@..."
              className="ds-input"
            />
            <p className="ds-hint">
              Hỗ trợ Facebook, YouTube, TikTok, Instagram — hệ thống tự nhận nền tảng từ link, không cần chọn tay.
              Quét Facebook, TikTok và Instagram đều <strong>tốn tiền</strong>; công cụ sẽ báo giá trước khi chạy.
            </p>
          </div>

          <div>
            <label className="ds-label" htmlFor="ch-note">
              Ghi chú (không bắt buộc)
            </label>
            <input
              id="ch-note"
              disabled={submitting}
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Vì sao bạn theo dõi kênh này?"
              className="ds-input"
            />
          </div>

          {error && <div className="ds-alert ds-alert-danger">{error}</div>}

          {duplicate && (
            <div className="ds-alert ds-alert-warning flex-col !items-stretch gap-2">
              <span>{duplicate.message}</span>
              <button type="button" onClick={() => onSelectExisting(duplicate.id)} className="ds-btn ds-btn-sm self-start">
                Xem kênh đã theo dõi
              </button>
            </div>
          )}

          {submitting && (
            <div className="ds-alert ds-alert-warning">
              <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden="true" />
              Đang thêm kênh...
            </div>
          )}
          <button type="submit" disabled={submitting} className="ds-btn ds-btn-primary justify-center mt-1">
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

function FollowerCountRow({
  detail,
  onSaved,
}: {
  detail: WatchedChannelDetail;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(detail.followerCount != null ? String(detail.followerCount) : "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const raw = value.trim();
      // Nhận cả "750000", "750.000" và "750,000" — người ta chép số từ Facebook
      // về thì hay dính dấu phân cách.
      await patchChannel(detail.id, { followerCount: raw ? Number(raw.replace(/[.,\s]/g, "")) : null });
      setEditing(false);
      onSaved();
    } catch (e: any) {
      setError(e?.message || "Không lưu được.");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2 mt-2 text-xs text-stone-500">
        <Users className="w-3.5 h-3.5 text-stone-400" aria-hidden="true" />
        {detail.followerCount != null ? (
          <span>
            <b className="text-stone-700">{numberFmt.format(detail.followerCount)}</b> người theo dõi
          </span>
        ) : (
          <span className="text-amber-700">
            Chưa biết số người theo dõi — thiếu số này thì không chấm được bài vượt bao nhiêu lần mức thường ngày.
          </span>
        )}
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="font-medium text-storm-700 hover:underline"
        >
          {detail.followerCount != null ? "Sửa" : "Nhập số"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 mt-2 flex-wrap">
      <label htmlFor={`fol-${detail.id}`} className="text-xs font-medium text-stone-600">
        Số người theo dõi
      </label>
      <input
        id={`fol-${detail.id}`}
        className="ds-input w-40 text-xs"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="vd 750000"
        autoFocus
      />
      <button type="button" onClick={save} disabled={saving} className="ds-btn ds-btn-primary ds-btn-sm">
        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : null} Lưu
      </button>
      <button type="button" onClick={() => setEditing(false)} className="ds-btn ds-btn-ghost ds-btn-sm">
        Huỷ
      </button>
      <span className="text-[11px] text-stone-400">Mở trang gốc, chép con số ở mục "người theo dõi" vào đây.</span>
      {error && <span className="text-[11px] text-red-600">{error}</span>}
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
  onRefreshed,
}: {
  detail: WatchedChannelDetail;
  watching: boolean;
  watchElapsedSec: number;
  watchTimedOut: boolean;
  onRefresh: () => void;
  onRequestDelete: () => void;
  onRefreshed?: () => void;
}) {
  const [repairing, setRepairing] = useState(false);
  // Lần lấy dữ liệu đầu tiên: nhãn "MỚI" chưa có nghĩa vì mọi bài đều mới.
  // Dùng số lần quét do backend đếm — đúng kể cả khi người dùng đổi máy.
  const isFirstScan = !!detail.lastScanAt && detail.scanCount <= 1 && !watching;

  return (
    <div className="flex flex-col gap-4">
      <div className="ds-card">
      <div className="ds-card-body">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex-1 min-w-0 flex gap-3">
            {/* Avatar kênh: nhận ra ngay đang xem kênh nào, không phải đọc URL. */}
            {detail.channelAvatarUrl ? (
              <img
                src={detail.channelAvatarUrl}
                alt=""
                className="w-11 h-11 rounded-full object-cover bg-stone-100 shrink-0"
                loading="lazy"
              />
            ) : (
              <span className="w-11 h-11 rounded-full bg-stone-100 shrink-0 flex items-center justify-center">
                <PlatformMark platform={detail.platform} className="w-5 h-5" />
              </span>
            )}
            <div className="min-w-0">
            <h2 className="text-lg font-bold text-stone-800 font-display truncate">
              {detail.channelName || detail.channelUrl}
            </h2>
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <span className="inline-flex items-center gap-1 text-[11px] text-stone-400">
                <PlatformMark platform={detail.platform} className="w-3 h-3" />
                {PLATFORM_LABEL[detail.platform] || detail.platform}
              </span>
              {detail.followerCount != null && (
                <span className="text-[11px] text-stone-400 flex items-center gap-0.5">
                  <Users className="w-3 h-3" aria-hidden="true" /> {formatMetric(detail.followerCount)} người theo dõi
                </span>
              )}
              <span className="text-[11px] text-stone-400 flex items-center gap-1">
                <Clock className="w-3 h-3" aria-hidden="true" /> {formatRelative(detail.lastScanAt)}
              </span>
              {detail.useApify && (
                <span className="ds-badge ds-badge-warning">
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
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* Sửa từ dữ liệu đã lưu trước: miễn phí, và nhiều khi đủ để lấp
                chỗ thiếu mà không phải quét lại. */}
            <button
              type="button"
              onClick={async () => {
                setRepairing(true);
                try {
                  const r = await repairChannel(detail.id);
                  alert(r.note);
                  onRefreshed?.();
                } catch (e: any) {
                  alert(e?.message || "Không sửa được số liệu.");
                } finally {
                  setRepairing(false);
                }
              }}
              disabled={repairing || watching}
              className="ds-btn ds-btn-ghost"
              title="Lấp số liệu còn thiếu bằng dữ liệu đã lưu — không tốn tiền"
            >
              {repairing ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : null}
              Sửa số liệu cũ
            </button>
            <button onClick={onRefresh} disabled={watching} className="ds-btn ds-btn-primary">
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
          <div role="alert" className="ds-alert ds-alert-danger mt-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
            Quá lâu không có phản hồi, thử tải lại trang.
          </div>
        ) : watching ? (
          <div className="ds-alert ds-alert-warning mt-2">
            <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" aria-hidden="true" />
            Đang lấy bài mới của kênh... ({watchElapsedSec}s)
          </div>
        ) : null}

        {detail.scanStatus === "error" && detail.errorMessage && (
          <div role="alert" className="ds-alert ds-alert-danger mt-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
            <span className="flex-1">{detail.errorMessage}</span>
            <button onClick={onRefresh} className="font-medium underline shrink-0">
              Thử lại
            </button>
          </div>
        )}

        {/* Nhập tay số người theo dõi.
            Với trang của người khác, Meta chỉ cho đọc số công khai khi ứng dụng
            đã được duyệt quyền riêng, còn Apify thì không phải lúc nào cũng trả
            về. Thiếu số này thì việc chấm "vượt mấy lần mức thường ngày" mất một
            trục — mà nhìn trang là đọc được trong hai giây. */}
        <FollowerCountRow detail={detail} onSaved={() => onRefreshed?.()} />

        {detail.lastNewCount > 0 && !watching && (
          <div className="ds-alert mt-2" style={{ background: "var(--ds-primary-light)", borderColor: "var(--ds-primary-mute)", color: "var(--ds-primary)" }}>
            <Flame className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            Có {detail.lastNewCount} bài mới kể từ lần làm mới trước.
          </div>
        )}
        {isFirstScan && (
          <div className="ds-alert mt-2">
            <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
            Đây là lần lấy dữ liệu đầu tiên nên chưa có gì để so sánh. Lần làm mới sau sẽ đánh dấu bài mới cho bạn.
          </div>
        )}
      </div>
      </div>

      <div className="flex flex-col gap-3">
        {detail.items.length === 0 ? (
          <div className="ds-card">
            <div className="ds-empty">
              <div className="ds-empty-icon">
                <ImageIcon className="w-8 h-8" aria-hidden="true" />
              </div>
              <p className="ds-empty-title">{detail.scanStatus === "scanning" ? "Đang lấy bài..." : "Chưa có bài nào"}</p>
              {detail.scanStatus !== "scanning" && <p className="ds-empty-desc">Bấm "Làm mới" ở trên để lấy dữ liệu bài đăng của kênh này.</p>}
            </div>
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
          {/* Ảnh bài giờ được giữ trong kho nội bộ (/api/files) nên PHẢI đi qua
              imageDisplayUrl để kèm token — dùng thẳng coverUrl là 401, ra ô trống. */}
          {item.coverUrl ? (
            <img src={imageDisplayUrl(item.coverUrl) || undefined} alt="" className="w-full h-full object-cover" loading="lazy" />
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
          <span className={`ds-badge ${conf.cls}`}>{conf.label}</span>
          <span className={`ds-badge ${src.cls}`}>{src.label}</span>
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
