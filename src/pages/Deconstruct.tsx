import { useEffect, useRef, useState, useCallback} from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  Loader2,
  Trash2,
  ExternalLink,
  AlertTriangle,
  Scissors,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  FileText,
  Video,
  Zap,
  HelpCircle,
  Anchor,
  Shuffle,
  Megaphone,
  Sparkles,
  PenLine,
  Clapperboard,
  ImagePlus,
  type LucideIcon, Coins } from "lucide-react";
import {
  listDeconstructions,
  getDeconstruction,
  createDeconstruction,
  createDeconstructionFromImage,
  deleteDeconstruction,
  pollDeconstruction,
  analyzePostComments,
} from "../services/deconstruct";
import ConfirmDialog from "../components/ConfirmDialog";
import type { DeconstructionRow, DeconstructedStructure, RetentionBeat, DeconstructAnalysisMode } from "../types";
import AudienceInsightPanel from "../components/AudienceInsightPanel";
import ImageReadingPanel from "../components/ImageReadingPanel";

// Trang "Bóc cấu trúc" — vì sao một bài giữ được người xem (docs/PRD.md §4
// J3). LINH HỒN màn này: trình bày theo NHỊP THỜI GIAN (không phải bảng phẳng)
// và mỗi mốc phải bấm được để tua thẳng tới video gốc — đây là cách người
// dùng tự kiểm chứng AI có nói đúng không. Theo dõi tiến độ dùng lại đúng cơ
// chế poll của trang Radar (services/deconstruct.ts::pollDeconstruction, port
// từ pollRadarJob).
// Nguồn là video hay bài viết — cùng một chữ "remake" nhưng hai đường khác nhau.
const CONTENT_KIND_LABEL: Record<string, string> = {
  video: "Nguồn: video",
  post: "Nguồn: bài viết",
  image: "Nguồn: ảnh",
};

const STATUS_META: Record<DeconstructionRow["status"], { label: string; cls: string }> = {
  pending: { label: "Đang chờ", cls: "" },
  downloading: { label: "Đang tải video...", cls: "ds-badge-warning" },
  analyzing: { label: "Đang phân tích...", cls: "ds-badge-warning" },
  ready: { label: "Đã có kết quả", cls: "ds-badge-success" },
  error: { label: "Lỗi", cls: "ds-badge-danger" },
};

const ANALYSIS_MODE_META: Record<DeconstructAnalysisMode, { label: string; cls: string; icon: LucideIcon }> = {
  video: { label: "Đã xem video", cls: "ds-badge-success", icon: Video },
  transcript: {
    label: "Chỉ đọc lời thoại (không xem được hình)",
    cls: "ds-badge-warning",
    icon: FileText,
  },
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("vi-VN");
}

function formatTimestamp(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function formatDuration(sec: number | null | undefined): string | null {
  if (sec === null || sec === undefined || sec <= 0) return null;
  return formatTimestamp(sec);
}

// Dựng link tua tới đúng giây trong video gốc — cách người dùng kiểm chứng AI
// có nói đúng không (yêu cầu #2 của màn này). YouTube hỗ trợ tham số `t`
// (giây) để tua thẳng tới; URLSearchParams.set tự thêm `?t=` nếu link chưa có
// query hoặc nối `&t=` nếu đã có sẵn. Các nền tảng khác (TikTok, Douyin,
// Facebook...) chưa có cách tua bằng URL nên vẫn mở đúng link gốc — không tua
// được nhưng vẫn kiểm chứng được.
function timestampUrl(sourceUrl: string, atSec: number): string {
  let u: URL;
  try {
    u = new URL(sourceUrl);
  } catch {
    return sourceUrl;
  }
  const host = u.hostname.replace(/^www\./, "").replace(/^m\./, "");
  const isYouTube = host === "youtube.com" || host === "youtu.be" || host === "music.youtube.com";
  if (isYouTube) {
    u.searchParams.set("t", `${Math.max(0, Math.round(atSec))}s`);
    return u.toString();
  }
  return sourceUrl;
}

// ===== Dòng thời gian — gộp mọi mốc (hook/mở vấn đề/giữ chân/twist/chốt) làm
// MỘT dòng chảy chung, sắp theo atSec tăng dần (không hardcode thứ tự theo
// hạng mục) — đây là mấu chốt để thấy được nhịp thật của bài. =====
type MomentKind = "hook" | "problem" | "beat" | "twist" | "cta";

interface Moment {
  kind: MomentKind;
  atSec: number;
  what: string;
  secondaryLabel?: string;
  secondary?: string | null;
}

const MOMENT_META: Record<MomentKind, { label: string; icon: LucideIcon; dot: string }> = {
  hook: { label: "3 giây đầu", icon: Zap, dot: "bg-storm-500" },
  problem: { label: "Mở vấn đề", icon: HelpCircle, dot: "bg-blue-500" },
  beat: { label: "Điểm giữ chân", icon: Anchor, dot: "bg-emerald-500" },
  twist: { label: "Twist", icon: Shuffle, dot: "bg-purple-500" },
  cta: { label: "Chốt (kêu gọi hành động)", icon: Megaphone, dot: "bg-amber-600" },
};

const MISSING_CATEGORY_LABELS: { key: keyof DeconstructedStructure; label: string }[] = [
  { key: "hook3s", label: "3 giây đầu" },
  { key: "problemOpen", label: "Mở vấn đề" },
  { key: "retentionBeats", label: "Điểm giữ chân" },
  { key: "twist", label: "Twist / bất ngờ" },
  { key: "cta", label: "Chốt (CTA)" },
];

function buildTimeline(s: DeconstructedStructure): Moment[] {
  const moments: Moment[] = [];
  if (s.hook3s) {
    moments.push({ kind: "hook", atSec: s.hook3s.atSec, what: s.hook3s.what, secondaryLabel: "Kỹ thuật", secondary: s.hook3s.technique });
  }
  if (s.problemOpen) {
    moments.push({ kind: "problem", atSec: s.problemOpen.atSec, what: s.problemOpen.what, secondaryLabel: "Cách vào vấn đề", secondary: s.problemOpen.how });
  }
  for (const b of s.retentionBeats || []) {
    moments.push({ kind: "beat", atSec: b.atSec, what: b.what, secondaryLabel: "Vì sao giữ chân", secondary: b.whyItWorks });
  }
  if (s.twist) {
    moments.push({ kind: "twist", atSec: s.twist.atSec, what: s.twist.what });
  }
  if (s.cta) {
    moments.push({ kind: "cta", atSec: s.cta.atSec, what: s.cta.what, secondaryLabel: "Kiểu chốt", secondary: s.cta.style });
  }
  return moments.sort((a, b) => a.atSec - b.atSec);
}

function missingCategories(s: DeconstructedStructure): string[] {
  return MISSING_CATEGORY_LABELS.filter(({ key }) => {
    const v = s[key];
    if (key === "retentionBeats") return !v || (v as RetentionBeat[]).length === 0;
    return v === null || v === undefined;
  }).map((m) => m.label);
}

export default function Deconstruct() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [jobs, setJobs] = useState<DeconstructionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DeconstructionRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeconstructionRow | null>(null);
  // Nội dung TikTok/Facebook/Instagram chỉ lấy được bằng dịch vụ có phí. Người
  // dùng phải tự bấm sau khi thấy giá — không bao giờ tự chạy.
  const [paidBusy, setPaidBusy] = useState(false);

  const handlePaidRetry = useCallback(
    async (row: DeconstructionRow) => {
      setPaidBusy(true);
      setDetailError(null);
      try {
        const created = await createDeconstruction({ url: row.sourceUrl, allowPaid: true });
        await reloadList();
        setSelectedId(created.id);
      } catch (e) {
        setDetailError(e instanceof Error ? e.message : "Không phân tích được.");
      } finally {
        setPaidBusy(false);
      }
    },
    [],
  );

  const [deleting, setDeleting] = useState(false);
  const [startingFromRadar, setStartingFromRadar] = useState(false);

  // Theo dõi bản đang tải/phân tích (chạy nền ở backend) — TÁI DÙNG đúng cơ
  // chế của trang Radar: ref cho "hàm huỷ" (không phải state) để
  // startWatching() luôn tự huỷ lượt theo dõi trước đó, và effect đổi
  // selectedId bên dưới đảm bảo dọn timer khi đổi bản xem / rời trang.
  const stopPollRef = useRef<(() => void) | null>(null);
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [watchElapsedSec, setWatchElapsedSec] = useState(0);
  const [watchTimedOut, setWatchTimedOut] = useState(false);

  async function reloadList() {
    setLoading(true);
    setListError(null);
    try {
      setJobs(await listDeconstructions());
    } catch (e: any) {
      setListError(e?.message || "Lỗi tải danh sách bản phân tích.");
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

  function syncJobInList(row: DeconstructionRow) {
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
    stopPollRef.current = pollDeconstruction(id, {
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

  async function loadAndWatch(id: string, opts: { silent?: boolean } = {}) {
    // silent: làm mới sau một thao tác (vừa phân tích xong bình luận) — bật cờ
    // loading lúc đó sẽ gỡ cả khối chi tiết, cuốn người dùng về đầu trang.
    if (!opts.silent) setDetailLoading(true);
    setDetailError(null);
    try {
      const d = await getDeconstruction(id);
      setDetail(d);
      syncJobInList(d);
      if (d.status === "pending" || d.status === "downloading" || d.status === "analyzing") startWatching(id);
    } catch (e: any) {
      setDetailError(e?.message || "Không tải được bản phân tích.");
      if (!opts.silent) setDetail(null);
    } finally {
      if (!opts.silent) setDetailLoading(false);
    }
  }

  useEffect(() => {
    // Xoá dữ liệu bản cũ ngay khi đổi lựa chọn — tránh thoáng hiện nhầm nội
    // dung của bản trước trong lúc đang tải bản mới.
    setDetail(null);
    setDetailError(null);
    if (selectedId) loadAndWatch(selectedId);
    // Dọn theo dõi (poll + đếm giây) khi đổi bản xem HOẶC rời trang — đây là
    // chỗ dễ rò rỉ timer nhất nếu quên.
    return () => stopWatching();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Vào thẳng từ một kết quả Radar (nút "Bóc cấu trúc" ở trang Radar điều
  // hướng tới đây kèm ?radarItemId=...) — tự bắt đầu phân tích một lần rồi
  // xoá tham số khỏi URL để không lặp lại khi tải lại trang.
  const consumedRadarItemRef = useRef(false);
  useEffect(() => {
    const radarItemId = searchParams.get("radarItemId");
    if (!radarItemId || consumedRadarItemRef.current) return;
    consumedRadarItemRef.current = true;
    setSearchParams(
      (p) => {
        p.delete("radarItemId");
        return p;
      },
      { replace: true },
    );
    (async () => {
      setStartingFromRadar(true);
      setListError(null);
      try {
        const result = await createDeconstruction({ radarItemId });
        setJobs((prev) => [result, ...prev]);
        setSelectedId(result.id);
      } catch (e: any) {
        setListError(e?.message || "Không bắt đầu phân tích được từ Radar.");
      } finally {
        setStartingFromRadar(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteDeconstruction(deleteTarget.id);
      setJobs((prev) => prev.filter((j) => j.id !== deleteTarget.id));
      if (selectedId === deleteTarget.id) setSelectedId(null);
      setDeleteTarget(null);
    } catch (e: any) {
      setListError(e?.message || "Xoá bản phân tích thất bại.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-bold text-stone-800 font-display flex items-center gap-2">
          <Scissors className="w-5 h-5 text-storm-500" aria-hidden="true" /> Bóc cấu trúc
        </h1>
        <p className="text-sm text-stone-500">
          Dán link một video để xem vì sao bài đó giữ được người xem: 3 giây đầu làm gì, mở vấn đề kiểu nào, giữ chân bằng gì,
          twist ở đâu, chốt thế nào — và rút ra một công thức để đem đi remake.
        </p>
      </div>

      <NewLinkForm
        onCreated={(row) => {
          setJobs((prev) => [row, ...prev]);
          setSelectedId(row.id);
        }}
      />

      {startingFromRadar && (
        <div className="ds-alert ds-alert-warning">
          <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden="true" /> Đang bắt đầu phân tích bài đã chọn từ Radar...
        </div>
      )}

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
                  <Scissors className="w-8 h-8" aria-hidden="true" />
                </div>
                <p className="ds-empty-title">Chưa có bản phân tích nào</p>
                <p className="ds-empty-desc">Dán link ở trên để bắt đầu bóc cấu trúc một bài.</p>
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
                <span className="text-sm font-semibold text-stone-800 truncate block">{j.title || j.sourceUrl}</span>
                <div className="flex items-center gap-1.5 flex-wrap mt-1">
                  <span className={`ds-badge ${STATUS_META[j.status].cls}`}>{STATUS_META[j.status].label}</span>
                  {j.platform && <span className="text-[10px] text-stone-400 capitalize">{j.platform}</span>}
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
                  <Scissors className="w-8 h-8" aria-hidden="true" />
                </div>
                <p className="ds-empty-title">Chưa chọn bản phân tích</p>
                <p className="ds-empty-desc">Chọn một bản phân tích bên trái để xem kết quả, hoặc dán link ở trên để bắt đầu.</p>
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
              <DeconstructDetailPanel
                key={detail.id}
                row={detail}
                watching={detail.status === "pending" || detail.status === "downloading" || detail.status === "analyzing"}
                watchElapsedSec={watchElapsedSec}
                watchTimedOut={watchTimedOut}
                onRequestDelete={() => setDeleteTarget(detail)}
                onRemake={() => navigate(`/remakes?deconstructionId=${detail.id}`)}
                onChanged={() => loadAndWatch(detail.id, { silent: true })}
                onPaidRetry={handlePaidRetry}
                paidBusy={paidBusy}
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

      <ConfirmDialog
        isOpen={!!deleteTarget}
        title="Xoá bản phân tích?"
        message={`Xoá bản phân tích "${deleteTarget?.title || deleteTarget?.sourceUrl}"? Không thể hoàn tác.${
          deleting ? " Đang xoá..." : ""
        }`}
        confirmText="Xoá"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function NewLinkForm({ onCreated }: { onCreated: (row: DeconstructionRow) => void }) {
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"link" | "image">("link");
  const [caption, setCaption] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) {
      setError("Dán link bài muốn phân tích.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await createDeconstruction({ url: trimmed });
      setUrl("");
      onCreated(result);
    } catch (e: any) {
      setError(e?.message || "Bắt đầu phân tích thất bại.");
    } finally {
      setSubmitting(false);
    }
  }

  // Dán ảnh từ bộ nhớ tạm: chụp màn hình xong Ctrl+V là xong, không phải lưu ra
  // tệp rồi đi tìm. Bắt ở cấp cửa sổ để người dùng không phải bấm vào ô nào
  // trước — nhưng chỉ khi đang ở chế độ ảnh, để không cướp Ctrl+V của ô nhập link.
  useEffect(() => {
    if (mode !== "image") return;
    function onPaste(e: ClipboardEvent) {
      if (submitting) return;
      for (const item of Array.from(e.clipboardData?.items || [])) {
        if (!item.type.startsWith("image/")) continue;
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          void handleImage(file);
          return;
        }
      }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  async function handleImage(file: File) {
    setSubmitting(true);
    setError(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Không đọc được tệp."));
        reader.readAsDataURL(file);
      });
      const row = await createDeconstructionFromImage({ imageBase64: dataUrl, caption: caption.trim() });
      setCaption("");
      onCreated(row as any);
    } catch (e: any) {
      setError(e?.message || "Không phân tích được ảnh.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="ds-card">
      <div className="ds-card-body flex flex-col gap-2.5">
        {/* Hai đường vào, khác nhau ở chỗ tốn tiền hay không — nói rõ ngay trên tab. */}
        <div className="flex gap-1 border-b border-stone-200 -mt-1">
          {(
            [
              ["link", "Từ link"],
              ["image", "Từ ảnh"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setMode(k)}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                mode === k ? "border-storm-600 text-storm-700" : "border-transparent text-stone-500 hover:text-stone-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "link" ? (
          <form onSubmit={handleSubmit} className="flex flex-col gap-2.5">
            <label htmlFor="dc-url" className="ds-label">
              Link video hoặc bài đăng (YouTube, TikTok, Facebook…) — hoặc bấm "Bóc cấu trúc" từ một bài trong Bài hay đã quét
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                id="dc-url"
                type="url"
                required
                disabled={submitting}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://..."
                className="ds-input flex-1"
              />
              <button type="submit" disabled={submitting} className="ds-btn ds-btn-primary shrink-0">
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Scissors className="w-4 h-4" aria-hidden="true" />}
                {submitting ? "Đang bắt đầu..." : "Phân tích"}
              </button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-2.5">
            <label htmlFor="dc-caption" className="ds-label">
              Ảnh chụp bài (ảnh chế, ảnh chat, đồ hoạ…) — công cụ đọc chữ trong ảnh rồi rút ra cách triển khai
            </label>
            <input
              id="dc-caption"
              className="ds-input"
              disabled={submitting}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Caption của bài, nếu có (không bắt buộc)"
            />
            <label className="ds-btn ds-btn-primary self-start cursor-pointer">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <ImagePlus className="w-4 h-4" aria-hidden="true" />}
              {submitting ? "Đang đọc ảnh..." : "Chọn ảnh để phân tích"}
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                disabled={submitting}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) handleImage(f);
                }}
              />
            </label>
            <p className="ds-hint">
              Chọn tệp, hoặc <strong>dán thẳng bằng Ctrl+V</strong> sau khi chụp màn hình. Miễn phí — chỉ dùng
              Gemini đọc ảnh, không tốn tiền quét. Tối đa 8MB.
            </p>
          </div>
        )}

        {error && <div role="alert" className="ds-alert ds-alert-danger">{error}</div>}
        {submitting && mode === "link" && (
          <div className="ds-alert ds-alert-warning">
            <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden="true" />
            Việc phân tích chạy nền, mất khoảng 1-3 phút — kết quả sẽ tự hiện bên dưới.
          </div>
        )}
      </div>
    </div>
  );
}

function DeconstructDetailPanel({
  row,
  watching,
  watchElapsedSec,
  watchTimedOut,
  onRequestDelete,
  onRemake,
  onPaidRetry,
  paidBusy,
  onChanged,
}: {
  row: DeconstructionRow;
  watching: boolean;
  watchElapsedSec: number;
  watchTimedOut: boolean;
  onRequestDelete: () => void;
  onRemake: () => void;
  onPaidRetry?: (row: DeconstructionRow) => void;
  paidBusy?: boolean;
  onChanged: () => void;
}) {
  // row.errorMessage được backend TÁI DÙNG để chở cảnh báo khi status=ready
  // (các mốc bị loại vì không đối chiếu được với độ dài video thật — tính
  // minh bạch, KHÔNG phải hỏng), CHỈ là lỗi thật khi status=error — xem
  // server/routes/deconstruct.routes.ts.
  const [cmtBusy, setCmtBusy] = useState(false);
  const [cmtError, setCmtError] = useState<string | null>(null);

  async function handleFetchComments(limit: number) {
    setCmtBusy(true);
    setCmtError(null);
    try {
      await analyzePostComments(row.id, limit);
      onChanged();
    } catch (e: any) {
      setCmtError(e?.message || "Không phân tích được bình luận.");
    } finally {
      setCmtBusy(false);
    }
  }

  const warningsText = row.status !== "error" ? row.errorMessage : null;
  const warnings = warningsText ? warningsText.split(" · ").filter(Boolean) : [];
  const duration = formatDuration(row.durationSec);
  const timeline = row.structure ? buildTimeline(row.structure) : [];
  const missing = row.structure ? missingCategories(row.structure) : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="ds-card">
      <div className="ds-card-body">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-stone-800 font-display truncate">{row.title || row.sourceUrl}</h2>
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <span className={`ds-badge ${STATUS_META[row.status].cls}`}>{STATUS_META[row.status].label}</span>
              {/* Loại nguồn đứng ngay cạnh trạng thái: nó quyết định remake đi
                  đường bài viết hay video, nên phải thấy trước khi bấm gì. */}
              {row.contentKind && row.contentKind !== "unknown" && (
                <span className="ds-badge">{CONTENT_KIND_LABEL[row.contentKind] || row.contentKind}</span>
              )}
              {row.platform && <span className="text-[11px] text-stone-400 capitalize">{row.platform}</span>}
              {duration && <span className="text-[11px] text-stone-400">Dài {duration}</span>}
              <span className="text-[11px] text-stone-400">{formatDate(row.createdAt)}</span>
              <a
                href={row.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-storm-700 hover:underline inline-flex items-center gap-0.5"
              >
                Link gốc <ExternalLink className="w-3 h-3" aria-hidden="true" />
              </a>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {row.status === "ready" && (
              <>
                <button onClick={onRemake} className="ds-btn ds-btn-primary ds-btn-sm">
                  <PenLine className="w-3.5 h-3.5" aria-hidden="true" /> Remake bài viết
                </button>
                {/* Nguồn là video thì lối sang dựng video mới đáng gợi ý; bản
                    viết vẫn phải làm trước nên nút này chỉ dẫn đường, không
                    nhảy cóc. */}
                {row.contentKind === "video" && (
                  <Link to="/videos" className="ds-btn ds-btn-ghost ds-btn-sm" title="Cần có bản viết đã duyệt trước">
                    <Clapperboard className="w-3.5 h-3.5" aria-hidden="true" /> Remake video
                  </Link>
                )}
              </>
            )}
            <button
              onClick={onRequestDelete}
              className="flex items-center gap-1 text-xs font-medium text-red-600 hover:bg-red-50 px-2.5 py-1.5 rounded-lg transition-colors shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" /> Xoá bản phân tích
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
            {row.status === "downloading"
              ? `Đang tải video... (${watchElapsedSec}s)`
              : `Đang phân tích... (${watchElapsedSec}s)`}
          </div>
        ) : null}

        {row.status === "error" && row.errorMessage && (
          <div
            role="alert"
            className={`ds-alert mt-2 ${row.needsPaid ? "ds-alert-warning" : "ds-alert-danger"} flex-col !items-stretch gap-2`}
          >
            <span className="flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
              {row.errorMessage}
            </span>
            {/* Nội dung TikTok/Facebook/Instagram chỉ lấy được qua dịch vụ có phí.
                Tuyệt đối không tự chạy — người dùng phải chủ động bấm sau khi thấy giá. */}
            {row.needsPaid && (
              <button
                type="button"
                onClick={() => onPaidRetry?.(row)}
                disabled={paidBusy}
                className="ds-btn ds-btn-primary ds-btn-sm self-start"
              >
                <Coins className="w-3.5 h-3.5" aria-hidden="true" />
                {paidBusy ? "Đang phân tích..." : `Phân tích có phí${row.estimatedCostUsd ? ` (~${row.estimatedCostUsd} USD)` : ""}`}
              </button>
            )}
          </div>
        )}

        {warnings.length > 0 && (
          <div className="ds-alert ds-alert-warning mt-2 flex-col !items-stretch gap-1">
            <span className="font-medium flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
              Hệ thống đã tự loại một số thông tin không đối chiếu được với video gốc — không phải lỗi, đây là tính năng minh
              bạch:
            </span>
            {warnings.map((w, i) => (
              <span key={i} className="pl-5">
                {w}
              </span>
            ))}
          </div>
        )}

        {row.status === "ready" && row.analysisMode && (
          <div className={`ds-badge mt-2.5 ${ANALYSIS_MODE_META[row.analysisMode].cls}`}>
            {(() => {
              const Icon = ANALYSIS_MODE_META[row.analysisMode].icon;
              return <Icon className="w-3.5 h-3.5" aria-hidden="true" />;
            })()}
            {ANALYSIS_MODE_META[row.analysisMode].label}
          </div>
        )}
      </div>
      </div>

      {row.status === "ready" && (
        <>
          <FormulaBlock formula={row.structure?.formula} />
          <div className="ds-card">
          <div className="ds-card-body">
            <h3 className="text-sm font-semibold text-stone-700 mb-3">Nhịp của bài (theo thời gian)</h3>
            {timeline.length === 0 ? (
              <p className="text-sm text-stone-400 italic">Không xác định được mốc thời gian nào.</p>
            ) : (
              <ol className="relative flex flex-col gap-4">
                <div className="absolute left-[9px] top-1.5 bottom-1.5 w-px bg-stone-200" aria-hidden="true" />
                {timeline.map((m, i) => {
                  const meta = MOMENT_META[m.kind];
                  const Icon = meta.icon;
                  return (
                    <li key={i} className="relative pl-8">
                      <span className={`absolute left-0 top-0.5 w-[18px] h-[18px] rounded-full flex items-center justify-center ${meta.dot}`}>
                        <Icon className="w-3 h-3 text-white" aria-hidden="true" />
                      </span>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold text-stone-500">{meta.label}</span>
                        <a
                          href={timestampUrl(row.sourceUrl, m.atSec)}
                          target="_blank"
                          rel="noreferrer"
                          title="Mở video tại đúng giây này để kiểm chứng"
                          className="ds-badge-primary ds-badge hover:bg-storm-100 transition-colors"
                        >
                          {formatTimestamp(m.atSec)} <ExternalLink className="w-3 h-3" aria-hidden="true" />
                        </a>
                      </div>
                      <p className="text-sm text-stone-700 mt-1 leading-relaxed">{m.what}</p>
                      {m.secondary && (
                        <p className="text-xs text-stone-400 mt-0.5">
                          <span className="font-medium text-stone-500">{m.secondaryLabel}:</span> {m.secondary}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
            {missing.length > 0 && (
              <p className="text-xs text-stone-400 italic mt-4 pt-3 border-t border-stone-100">
                Không xác định được: {missing.join(", ")}.
              </p>
            )}
          </div>
          </div>

          {row.structure?.notes && (
            <div className="ds-card">
              <div className="ds-card-body">
                <h3 className="text-sm font-semibold text-stone-700 mb-1.5">Ghi chú thêm</h3>
                <p className="text-sm text-stone-600 leading-relaxed whitespace-pre-wrap">{row.structure.notes}</p>
              </div>
            </div>
          )}

          {/* Ảnh đứng trước bình luận: với nhiều bài, đây là nội dung chính. */}
          {row.imageReading && (
            <ImageReadingPanel reading={row.imageReading} thumbnailUrl={row.thumbnailUrl} />
          )}

          <AudienceInsightPanel
            deconstructionId={row.id}
            insight={row.audienceInsight}
            commentsFetchedAt={row.commentsFetchedAt}
            platform={row.platform}
            busy={cmtBusy}
            onFetch={handleFetchComments}
            error={cmtError}
          />

          {row.transcript && <TranscriptBlock transcript={row.transcript} />}
        </>
      )}
    </div>
  );
}

function FormulaBlock({ formula }: { formula: string | null | undefined }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (!formula) return;
    try {
      await navigator.clipboard.writeText(formula);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard có thể bị chặn (quyền trình duyệt) — im lặng, không chặn UI.
    }
  }

  return (
    <div className="ds-card" style={{ borderColor: "var(--ds-primary-mute)", borderWidth: 2 }}>
      <div className="ds-card-body flex flex-col gap-2.5" style={{ background: "var(--ds-primary-light)" }}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="flex items-center gap-1.5 text-sm font-bold text-storm-800">
          <Sparkles className="w-4 h-4" aria-hidden="true" /> Công thức để remake
        </h3>
        <button onClick={handleCopy} disabled={!formula} className="ds-btn ds-btn-sm">
          {copied ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
          {copied ? "Đã sao chép" : "Sao chép"}
        </button>
      </div>
      {formula ? (
        <p className="text-sm text-storm-900 leading-relaxed whitespace-pre-wrap">{formula}</p>
      ) : (
        <p className="text-sm text-stone-400 italic">Không xác định được.</p>
      )}
      </div>
    </div>
  );
}

function TranscriptBlock({ transcript }: { transcript: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ds-card">
      <div className="ds-card-body">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center justify-between w-full text-sm font-semibold text-stone-700"
      >
        <span className="flex items-center gap-1.5">
          <FileText className="w-4 h-4 text-stone-400" aria-hidden="true" /> Lời thoại đầy đủ
        </span>
        {open ? <ChevronUp className="w-4 h-4" aria-hidden="true" /> : <ChevronDown className="w-4 h-4" aria-hidden="true" />}
      </button>
      {open && (
        <p className="mt-2.5 text-xs text-stone-600 leading-relaxed whitespace-pre-wrap max-h-72 overflow-y-auto bg-stone-50 rounded-lg p-3 border border-stone-100">
          {transcript}
        </p>
      )}
      </div>
    </div>
  );
}
