import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Plus,
  X,
  Loader2,
  Trash2,
  ExternalLink,
  AlertTriangle,
  Telescope,
  Eye,
  Heart,
  MessageCircle,
  Share2,
  Users,
  Info,
  Sparkles,
  Scissors,
  Image as ImageIcon,
} from "lucide-react";
import {
  listRadarJobs,
  createRadarJob,
  getRadarJob,
  getEnrichQuote,
  enrichRadarJob,
  deleteRadarJob,
  pollRadarJob,
  type CreateRadarInput,
} from "../services/radar";
import ConfirmDialog from "../components/ConfirmDialog";
import type { RadarJob, RadarJobDetail, RadarItem, RadarQueryKind, RadarConfidence, RadarMetricsSource, RadarEnrichQuote } from "../types";

// Trang "Radar" — tìm content đang bật lên trong một ngách. LINH HỒN màn này:
// KHÔNG xếp theo lượt like tuyệt đối mà xếp theo mức vượt trội so với quy mô
// của chính kênh đó (docs/PRD.md §4 J2, server/services/outperform.ts). Quy
// trình 2 bước cố ý tách rời: quét (miễn phí) rồi bổ sung số liệu (tốn tiền
// qua Apify, chỉ chạy khi người dùng chủ động bấm + xác nhận chi phí).
const PLATFORM_DEFS: { key: string; label: string; note?: string }[] = [
  { key: "youtube", label: "YouTube" },
  { key: "tiktok", label: "TikTok" },
  { key: "douyin", label: "Douyin", note: "Có thể chưa quét miễn phí được" },
  { key: "instagram", label: "Instagram", note: "Có thể chưa quét miễn phí được" },
];
const PLATFORM_LABEL: Record<string, string> = Object.fromEntries(PLATFORM_DEFS.map((p) => [p.key, p.label]));

const STATUS_META: Record<RadarJob["status"], { label: string; cls: string }> = {
  pending: { label: "Đang chờ", cls: "" },
  scanning: { label: "Đang quét...", cls: "ds-badge-warning" },
  enriching: { label: "Đang bổ sung số liệu...", cls: "ds-badge-warning" },
  ready: { label: "Đã có kết quả", cls: "ds-badge-success" },
  error: { label: "Lỗi", cls: "ds-badge-danger" },
};

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

export default function Radar() {
  const [jobs, setJobs] = useState<RadarJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RadarJobDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RadarJob | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Theo dõi phiên đang quét/bổ sung số liệu (chạy nền ở backend). Dùng ref
  // thay vì state cho các "hàm huỷ" để không phải nhớ dọn ở mọi nơi gọi —
  // startWatching() luôn tự huỷ lượt theo dõi trước đó trước khi bắt đầu lượt
  // mới, và effect bên dưới đảm bảo dọn khi đổi phiên xem / rời trang.
  const stopPollRef = useRef<(() => void) | null>(null);
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [watchElapsedSec, setWatchElapsedSec] = useState(0);
  const [watchTimedOut, setWatchTimedOut] = useState(false);

  async function reloadList() {
    setLoading(true);
    setListError(null);
    try {
      setJobs(await listRadarJobs());
    } catch (e: any) {
      setListError(e?.message || "Lỗi tải danh sách phiên quét.");
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

  function syncJobInList(row: RadarJob) {
    setJobs((prev) => prev.map((j) => (j.id === row.id ? { ...j, ...row } : j)));
  }

  function startWatching(id: string) {
    stopWatching();
    setWatchTimedOut(false);
    const startedAt = Date.now();
    setWatchElapsedSec(0);
    tickTimerRef.current = setInterval(() => {
      setWatchElapsedSec(Math.round((Date.now() - startedAt) / 1000));
    }, 1000);
    stopPollRef.current = pollRadarJob(id, {
      onUpdate: (d) => {
        setDetail(d);
        syncJobInList(d);
        if (d.status === "ready" || d.status === "error") stopWatching();
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

  // Tải chi tiết một phiên; nếu đang chạy nền (scanning/enriching) thì bắt
  // đầu theo dõi luôn. Dùng lại cho: chọn phiên khác, và sau khi bấm bổ sung
  // số liệu trên phiên đang xem (xem EnrichSection bên dưới).
  async function loadAndWatch(id: string) {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const d = await getRadarJob(id);
      setDetail(d);
      syncJobInList(d);
      if (d.status === "scanning" || d.status === "enriching") startWatching(id);
    } catch (e: any) {
      setDetailError(e?.message || "Không tải được kết quả phiên quét.");
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    // Xoá dữ liệu phiên cũ ngay khi đổi lựa chọn — tránh thoáng hiện nhầm nội
    // dung của phiên trước trong lúc đang tải phiên mới.
    setDetail(null);
    setDetailError(null);
    if (selectedId) loadAndWatch(selectedId);
    // Dọn theo dõi (poll + đếm giây) khi đổi phiên xem HOẶC rời trang — đây là
    // chỗ dễ rò rỉ timer nhất nếu quên.
    return () => stopWatching();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteRadarJob(deleteTarget.id);
      setJobs((prev) => prev.filter((j) => j.id !== deleteTarget.id));
      if (selectedId === deleteTarget.id) setSelectedId(null);
      setDeleteTarget(null);
    } catch (e: any) {
      setListError(e?.message || "Xoá phiên quét thất bại.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-stone-800 font-display">Bài hay đã quét</h1>
          <p className="text-sm text-stone-500">
            Bài đang bật lên trên các kênh bạn theo dõi — xếp theo mức vượt trội so với quy mô của chính kênh đó, không phải
            theo lượt thích tuyệt đối. Thấy bài đáng học thì đưa sang <strong>Bóc cấu trúc</strong>.
          </p>
        </div>
        <button onClick={() => setShowNewForm(true)} className="ds-btn ds-btn-primary shrink-0">
          <Plus className="w-4 h-4" aria-hidden="true" /> Quét ngách mới
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
          ) : jobs.length === 0 ? (
            <div className="ds-card">
              <div className="ds-empty">
                <div className="ds-empty-icon">
                  <Telescope className="w-8 h-8" aria-hidden="true" />
                </div>
                <p className="ds-empty-title">Chưa có phiên quét nào</p>
                <p className="ds-empty-desc">Quét một ngách hoặc link đối thủ để tìm content đang bật lên.</p>
                <button onClick={() => setShowNewForm(true)} className="ds-btn ds-btn-primary ds-btn-sm mt-1">
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Quét ngách mới
                </button>
              </div>
            </div>
          ) : (
            jobs.map((j) => (
              <button
                key={j.id}
                onClick={() => setSelectedId(j.id)}
                className={`text-left rounded-xl border px-3 py-2.5 transition-colors ${
                  selectedId === j.id ? "border-storm-400 bg-storm-50" : "border-stone-200 bg-white hover:border-stone-300"
                }`}
              >
                <span className="text-sm font-semibold text-stone-800 truncate block">{j.query}</span>
                <div className="flex items-center gap-1.5 flex-wrap mt-1">
                  <span className={`ds-badge ${STATUS_META[j.status].cls}`}>{STATUS_META[j.status].label}</span>
                  <span className="text-[10px] text-stone-400">{j.platforms.map((p) => PLATFORM_LABEL[p] || p).join(", ")}</span>
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
                  <Telescope className="w-8 h-8" aria-hidden="true" />
                </div>
                <p className="ds-empty-title">Chưa chọn phiên quét</p>
                <p className="ds-empty-desc">Chọn một phiên quét bên trái để xem kết quả, hoặc quét ngách mới.</p>
              </div>
            </div>
          ) : detail ? (
            <>
              {/* Lỗi xảy ra trong lúc đang theo dõi (đã có dữ liệu cũ) — hiện dạng
                  banner, KHÔNG thay hẳn nội dung để không mất kết quả đã có. */}
              {detailError && (
                <div role="alert" className="ds-alert ds-alert-danger mb-3">
                  {detailError}
                </div>
              )}
              <RadarDetailPanel
                key={detail.id}
                detail={detail}
                watching={detail.status === "scanning" || detail.status === "enriching"}
                watchElapsedSec={watchElapsedSec}
                watchTimedOut={watchTimedOut}
                onChanged={() => loadAndWatch(detail.id)}
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

      {showNewForm && (
        <NewRadarForm
          onClose={() => setShowNewForm(false)}
          onCreated={(row) => {
            setJobs((prev) => [row, ...prev]);
            setSelectedId(row.id);
            setShowNewForm(false);
          }}
        />
      )}

      <ConfirmDialog
        isOpen={!!deleteTarget}
        title="Xoá phiên quét?"
        message={`Xoá phiên quét "${deleteTarget?.query}" cùng toàn bộ kết quả đã tìm được? Không thể hoàn tác.${deleting ? " Đang xoá..." : ""}`}
        confirmText="Xoá"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function NewRadarForm({ onClose, onCreated }: { onClose: () => void; onCreated: (row: RadarJob) => void }) {
  const [queryKind, setQueryKind] = useState<RadarQueryKind>("keyword");
  const [query, setQuery] = useState("");
  const [platforms, setPlatforms] = useState<string[]>(["youtube"]);
  const [limit, setLimit] = useState(30);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function togglePlatform(key: string) {
    setPlatforms((prev) => (prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key]));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (platforms.length === 0) {
      setError("Chọn ít nhất một nền tảng.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const input: CreateRadarInput = { query: query.trim(), queryKind, platforms, limit };
      const result = await createRadarJob(input);
      onCreated(result);
    } catch (e: any) {
      setError(e?.message || "Quét thất bại.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="ds-modal-overlay open" style={{ zIndex: 100 }}>
      <div className="ds-modal max-h-[90vh] overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="new-radar-title">
        <div className="ds-modal-header">
          <h3 id="new-radar-title" className="ds-modal-title font-display">
            Quét ngách mới
          </h3>
          <button onClick={onClose} disabled={submitting} className="ds-modal-close disabled:opacity-40" aria-label="Đóng">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="ds-modal-body flex flex-col gap-3">
          <div>
            <span className="block text-xs font-medium text-stone-600 mb-1">Bạn muốn soi gì?</span>
            <div className="flex gap-3">
              <label className="flex items-center gap-1.5 text-sm text-stone-600">
                <input
                  type="radio"
                  name="queryKind"
                  checked={queryKind === "keyword"}
                  onChange={() => setQueryKind("keyword")}
                  className="accent-storm-600"
                  disabled={submitting}
                />
                Từ khoá ngách
              </label>
              <label className="flex items-center gap-1.5 text-sm text-stone-600">
                <input
                  type="radio"
                  name="queryKind"
                  checked={queryKind === "competitor"}
                  onChange={() => setQueryKind("competitor")}
                  className="accent-storm-600"
                  disabled={submitting}
                />
                Link đối thủ
              </label>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1" htmlFor="rd-query">
              {queryKind === "keyword" ? "Từ khoá ngách" : "Link kênh/bài của đối thủ"}
            </label>
            <input
              id="rd-query"
              required
              disabled={submitting}
              type={queryKind === "competitor" ? "url" : "text"}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={queryKind === "keyword" ? "Ví dụ: mẹo tiết kiệm điện" : "https://..."}
              className="ds-input"
            />
          </div>

          <fieldset disabled={submitting} className="flex flex-col gap-1.5">
            <legend className="block text-xs font-medium text-stone-600 mb-1">Nền tảng</legend>
            {PLATFORM_DEFS.map((p) => (
              <label key={p.key} className="flex items-center gap-1.5 text-sm text-stone-600">
                <input
                  type="checkbox"
                  checked={platforms.includes(p.key)}
                  onChange={() => togglePlatform(p.key)}
                  className="accent-storm-600"
                />
                {p.label}
                {p.note && <span className="text-xs text-stone-400 italic">({p.note})</span>}
              </label>
            ))}
          </fieldset>

          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1" htmlFor="rd-limit">
              Số lượng bài muốn quét (mỗi nền tảng, tối đa 100)
            </label>
            <input
              id="rd-limit"
              type="number"
              min={1}
              max={100}
              disabled={submitting}
              value={limit}
              onChange={(e) => setLimit(Math.min(100, Math.max(1, Number(e.target.value) || 1)))}
              className="ds-input w-28"
            />
          </div>

          {error && <div className="ds-alert ds-alert-danger">{error}</div>}
          {submitting && (
            <div className="ds-alert ds-alert-warning">
              <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden="true" />
              Đang bắt đầu quét...
            </div>
          )}
          <button type="submit" disabled={submitting} className="ds-btn ds-btn-primary justify-center mt-1">
            {submitting && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />} {submitting ? "Đang bắt đầu..." : "Bắt đầu quét"}
          </button>
        </form>
      </div>
    </div>
  );
}

function RadarDetailPanel({
  detail,
  watching,
  watchElapsedSec,
  watchTimedOut,
  onChanged,
  onRequestDelete,
}: {
  detail: RadarJobDetail;
  watching: boolean;
  watchElapsedSec: number;
  watchTimedOut: boolean;
  onChanged: () => void;
  onRequestDelete: () => void;
}) {
  // job.errorMessage được backend TÁI DÙNG để chở cảnh báo khi status=ready
  // (vd nền tảng chưa quét được), CHỈ là lỗi thật khi status=error — xem
  // server/routes/radar.routes.ts POST /api/radar.
  const warningsText = detail.status !== "error" ? detail.errorMessage : null;
  const warnings = warningsText ? warningsText.split(" · ").filter(Boolean) : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="ds-card">
      <div className="ds-card-body">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-stone-800 font-display truncate">{detail.query}</h2>
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <span className={`ds-badge ${STATUS_META[detail.status].cls}`}>{STATUS_META[detail.status].label}</span>
              <span className="text-[11px] text-stone-400">
                {detail.queryKind === "keyword" ? "Từ khoá ngách" : "Link đối thủ"} ·{" "}
                {detail.platforms.map((p) => PLATFORM_LABEL[p] || p).join(", ")}
              </span>
              <span className="text-[11px] text-stone-400">
                {detail.scannedCount} bài đã quét
                {detail.enrichedCount > 0 ? ` · ${detail.enrichedCount} bài đã bổ sung số liệu` : ""}
              </span>
            </div>
          </div>
          <button
            onClick={onRequestDelete}
            className="flex items-center gap-1 text-xs font-medium text-red-600 hover:bg-red-50 px-2.5 py-1.5 rounded-lg transition-colors shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" /> Xoá phiên quét
          </button>
        </div>

        {watchTimedOut ? (
          <div role="alert" className="ds-alert ds-alert-danger mt-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
            Quá lâu không có phản hồi, thử tải lại trang.
          </div>
        ) : watching ? (
          <div className="ds-alert ds-alert-warning mt-2">
            <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" aria-hidden="true" />
            {detail.status === "scanning"
              ? `Đang quét... đã tìm được ${detail.scannedCount} bài (${watchElapsedSec}s)`
              : `Đang bổ sung số liệu... (${watchElapsedSec}s)`}
          </div>
        ) : null}

        {detail.status === "error" && detail.errorMessage && (
          <div role="alert" className="ds-alert ds-alert-danger mt-2">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
            {detail.errorMessage}
          </div>
        )}
        {warnings.length > 0 && (
          <div className="ds-alert ds-alert-warning mt-2 flex-col !items-stretch gap-1">
            {warnings.map((w, i) => (
              <span key={i} className="flex items-start gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                {w}
              </span>
            ))}
          </div>
        )}
      </div>
      </div>

      <EnrichSection detail={detail} onChanged={onChanged} />

      <div className="flex flex-col gap-3">
        {detail.items.length === 0 ? (
          <div className="ds-card">
            <div className="ds-empty">
              <div className="ds-empty-icon">
                <ImageIcon className="w-8 h-8" aria-hidden="true" />
              </div>
              <p className="ds-empty-title">{detail.status === "scanning" || detail.status === "pending" ? "Đang quét..." : "Chưa tìm thấy bài nào phù hợp"}</p>
            </div>
          </div>
        ) : (
          detail.items.map((item) => (
            <RadarItemCard key={item.id} item={item} minSampleForBaseline={detail.minSampleForBaseline} />
          ))
        )}
      </div>
    </div>
  );
}

function EnrichSection({ detail, onChanged }: { detail: RadarJobDetail; onChanged: () => void }) {
  // detail.status !== "ready" đã bao trọn cả hai trạng thái đang chạy nền
  // (scanning/enriching) — dùng chung để chặn bấm chồng, không cần cờ riêng.
  const scanOnlyCount = detail.items.filter((i) => i.metricsSource === "scan").length;
  const defaultTop = Math.min(10, scanOnlyCount || 10);
  const [top, setTop] = useState(defaultTop);
  const [quote, setQuote] = useState<RadarEnrichQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultInfo, setResultInfo] = useState<string | null>(null);
  // Nhớ lại số bài đã bổ sung TRƯỚC KHI lượt bổ sung này bắt đầu, để khi phiên
  // quay lại "ready" (qua theo dõi ở component cha) tính được đã bổ sung thêm
  // bao nhiêu bài mà không cần backend trả kết quả cuối cùng ngay lập tức.
  const pendingRef = useRef<{ startEnrichedCount: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setQuoting(true);
      try {
        const q = await getEnrichQuote(detail.id, top);
        if (!cancelled) setQuote(q);
      } catch {
        // im lặng — chỉ dùng để biết apifyConfigured/chi phí, không chặn xem kết quả
      } finally {
        if (!cancelled) setQuoting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.id, top]);

  async function openConfirm() {
    setError(null);
    setResultInfo(null);
    setQuoting(true);
    try {
      const q = await getEnrichQuote(detail.id, top);
      setQuote(q);
      setConfirmOpen(true);
    } catch (e: any) {
      setError(e?.message || "Không ước tính được chi phí.");
    } finally {
      setQuoting(false);
    }
  }

  async function handleEnrich() {
    setConfirmOpen(false);
    setEnriching(true);
    setError(null);
    setResultInfo(null);
    try {
      const result = await enrichRadarJob(detail.id, top);
      if ("willEnrich" in result) {
        // Đã bắt đầu, việc bổ sung chạy ngầm — nhờ component cha theo dõi tiếp
        // (poll GET /api/radar/:id) và ghi nhớ mốc để báo kết quả khi xong.
        pendingRef.current = { startEnrichedCount: detail.enrichedCount };
        setResultInfo(
          `Đã bắt đầu bổ sung số liệu cho ${result.willEnrich} bài, ước tính khoảng ${result.estimatedCostUsd.toLocaleString("vi-VN")} USD. Việc này chạy ngầm, kết quả sẽ tự cập nhật bên dưới.`,
        );
        onChanged();
      } else {
        setResultInfo(result.message || "Không còn bài nào cần bổ sung số liệu.");
      }
    } catch (e: any) {
      setError(e?.message || "Không bổ sung được số liệu.");
    } finally {
      setEnriching(false);
    }
  }

  // Khi lượt bổ sung do CHÍNH lần bấm này khởi động quay về "ready", thay
  // dòng "đã bắt đầu..." bằng kết quả cuối cùng.
  useEffect(() => {
    if (!pendingRef.current) return;
    if (detail.status === "ready") {
      const delta = detail.enrichedCount - pendingRef.current.startEnrichedCount;
      pendingRef.current = null;
      setResultInfo(
        delta > 0 ? `Đã bổ sung số liệu xong cho ${delta} bài.` : "Đã xử lý xong, không có bài nào bổ sung được thêm.",
      );
    } else if (detail.status === "error") {
      pendingRef.current = null;
      setError("Bổ sung số liệu gặp lỗi, thử lại sau.");
    }
  }, [detail.status, detail.enrichedCount]);

  const apifyOff = quote ? !quote.apifyConfigured : false;
  const disabled = enriching || detail.status !== "ready" || scanOnlyCount === 0 || apifyOff;

  return (
    <div className="ds-card">
      <div className="ds-card-body flex flex-col gap-2.5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-semibold text-stone-700 flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-storm-500" aria-hidden="true" /> Bổ sung số liệu
          </h3>
          <p className="text-xs text-stone-400 mt-0.5">
            Lấy thêm lượt thích, bình luận, chia sẻ, người theo dõi cho các bài đầu bảng — dùng dịch vụ ngoài nên tốn tiền, chỉ
            chạy khi bạn xác nhận chi phí.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-stone-500" htmlFor="rd-top">
            Số bài
          </label>
          <input
            id="rd-top"
            type="number"
            min={1}
            max={50}
            value={top}
            disabled={enriching || detail.status !== "ready"}
            onChange={(e) => setTop(Math.min(50, Math.max(1, Number(e.target.value) || 1)))}
            className="w-16 rounded-lg border border-stone-300 px-2 py-1.5 text-sm disabled:opacity-60"
          />
          <button
            onClick={openConfirm}
            disabled={disabled || quoting}
            title={apifyOff ? "Chưa cấu hình dịch vụ bổ sung số liệu (Apify)." : scanOnlyCount === 0 ? "Không còn bài nào cần bổ sung số liệu." : undefined}
            className="ds-btn ds-btn-primary shrink-0"
          >
            {enriching || quoting ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Sparkles className="w-4 h-4" aria-hidden="true" />}
            {enriching ? "Đang bổ sung..." : "Bổ sung số liệu"}
          </button>
        </div>
      </div>

      {apifyOff && (
        <div className="ds-alert ds-alert-warning">
          Chưa cấu hình dịch vụ bổ sung số liệu (Apify) nên không thể bổ sung lúc này.
        </div>
      )}
      {scanOnlyCount === 0 && !apifyOff && <p className="text-xs text-stone-400">Tất cả bài đã có số liệu đầy đủ, không còn bài nào cần bổ sung.</p>}
      {quote && !apifyOff && scanOnlyCount > 0 && (
        <p className="text-xs text-stone-400">
          Ước tính: bổ sung {quote.count} bài, khoảng {quote.estimatedCostUsd.toLocaleString("vi-VN")} USD · đã dùng{" "}
          {quote.resultsUsedToday} lượt hôm nay.
        </p>
      )}
      {error && <div className="ds-alert ds-alert-danger">{error}</div>}
      {resultInfo && <div className="ds-alert ds-alert-success">{resultInfo}</div>}

      <ConfirmDialog
        isOpen={confirmOpen}
        title="Xác nhận bổ sung số liệu"
        message={
          quote
            ? `Sẽ bổ sung số liệu cho ${quote.count} bài, chi phí khoảng ${quote.estimatedCostUsd.toLocaleString("vi-VN")} USD. Đây là chi phí thật (qua Apify). Tiếp tục?`
            : "Đang chuẩn bị ước tính chi phí..."
        }
        confirmText="Đồng ý, bổ sung"
        cancelText="Thôi"
        onConfirm={handleEnrich}
        onCancel={() => setConfirmOpen(false)}
      />
      </div>
    </div>
  );
}

function RadarItemCard({ item, minSampleForBaseline }: { item: RadarItem; minSampleForBaseline: number }) {
  const navigate = useNavigate();
  const score = item.outperformScore != null ? (item.outperformScore / 10).toFixed(1) : null;
  const conf = CONFIDENCE_META[item.confidence];
  const src = SOURCE_META[item.metricsSource];
  const duration = formatDuration(item.durationSec);
  const reasons = item.scoreBreakdown?.reasons || [];

  return (
    <div className="ds-card">
      <div className="ds-card-body flex flex-col sm:flex-row gap-4">
      <div className="w-full sm:w-40 shrink-0">
        <div className="relative w-full aspect-video rounded-lg overflow-hidden bg-stone-100 flex items-center justify-center">
          {item.coverUrl ? (
            <img src={item.coverUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
          ) : (
            <ImageIcon className="w-6 h-6 text-stone-300" aria-hidden="true" />
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
            <p className="text-xs text-stone-500 mt-0.5">
              {item.channelName || "Kênh không rõ tên"} · <span className="text-stone-400">{PLATFORM_LABEL[item.platform] || item.platform}</span> ·{" "}
              {formatDate(item.publishedAt)}
            </p>
          </div>
          <div className="text-right shrink-0">
            <div className="text-2xl font-bold text-storm-700 font-display leading-none">{score ?? "—"}</div>
            <div className="text-[10px] text-stone-400 mt-0.5">/ 100 điểm</div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Chỉ gắn nhãn cho bài đáng chú ý. Bài "chưa nổi bật" không hiện gì:
              máy chấm sai thì một cái nhãn phủ định sẽ khiến người dùng lướt qua
              bài đáng làm. */}
          {item.verdict && item.verdict.level !== "chua_noi_bat" && (
            <span
              className={`ds-badge ${item.verdict.level === "nen_lam" ? "ds-badge-success" : "ds-badge-warning"}`}
              title={item.verdict.reason}
            >
              {item.verdict.label}
            </span>
          )}
          <span className={`ds-badge ${conf.cls}`}>{conf.label}</span>
          <span className={`ds-badge ${src.cls}`}>{src.label}</span>
        </div>

        {item.verdict && item.verdict.level !== "chua_noi_bat" && (
          <div className="text-xs bg-storm-50 border border-storm-200 rounded-lg px-2.5 py-2">
            <p className="text-storm-900">{item.verdict.reason}</p>
            {item.verdict.whatToLearn && (
              <p className="text-storm-700 mt-1">{item.verdict.whatToLearn}</p>
            )}
          </div>
        )}

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
          <span className="flex items-center gap-1" title="Người theo dõi kênh">
            <Users className="w-3.5 h-3.5 text-stone-400" aria-hidden="true" /> {formatMetric(item.followerCount)}
          </span>
          <button
            onClick={() => navigate(`/deconstruct?radarItemId=${item.id}`)}
            className="ml-auto flex items-center gap-1 text-xs font-medium text-storm-700 hover:bg-storm-50 px-2 py-1 rounded-lg transition-colors shrink-0"
            title="Phân tích vì sao bài này giữ được người xem"
          >
            <Scissors className="w-3.5 h-3.5" aria-hidden="true" /> Bóc cấu trúc
          </button>
        </div>

        {/* Điểm đến từ đâu: thấy được mới tin được, và mới biết nên đọc kỹ chỗ nào. */}
        {item.scoreBreakdown && (
          <div className="flex items-center gap-3 flex-wrap text-[11px]">
            {(
              [
                ["Hơn mức thường của kênh", item.scoreBreakdown.vsChannelMedian],
                ["Người đọc phản ứng", item.scoreBreakdown.engagementDepth],
                ["So với quy mô kênh", item.scoreBreakdown.vsFollowers],
                ["Độ mới", item.scoreBreakdown.freshness],
              ] as [string, number | null | undefined][]
            ).map(([label, v]) => (
              <span key={label} className="flex items-center gap-1.5">
                <span className="text-stone-400">{label}</span>
                {v == null ? (
                  <span className="text-stone-300" title="Chưa có số liệu cho phần này">
                    —
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1">
                    <span className="w-10 h-1.5 rounded-full bg-stone-200 overflow-hidden">
                      <span className="block h-full bg-storm-500" style={{ width: `${Math.round(v * 100)}%` }} />
                    </span>
                    <span className="text-stone-600 font-medium">{Math.round(v * 100)}</span>
                  </span>
                )}
              </span>
            ))}
          </div>
        )}

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
            Kênh này chưa đủ {minSampleForBaseline} bài để có mốc riêng nên điểm chỉ mang tính tham khảo.
          </p>
        )}
      </div>
      </div>
    </div>
  );
}
