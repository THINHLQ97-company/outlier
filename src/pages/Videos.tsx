import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Clapperboard,
  Loader2,
  Trash2,
  AlertTriangle,
  Plus,
  Smartphone,
  RectangleHorizontal,
  Download,
  Save,
  Wand2,
  DollarSign,
  CheckCircle2,
  Info,
  FileVideo,
  Clock,
  PenLine,
  Film,
} from "lucide-react";
import { listRemakes } from "../services/remakes";
import {
  listVideos,
  getVideo,
  createVideo,
  patchScene,
  getVideoQuote,
  generateVideoScenes,
  renderVideo,
  deleteVideo,
  pollVideo,
  isVideoBusy,
  type PatchSceneInput,
} from "../services/videos";
import { imageDisplayUrl } from "../services/http";
import ConfirmDialog from "../components/ConfirmDialog";
import type {
  RemakeRow,
  RemakeFormat,
  VideoProject,
  VideoProjectDetail,
  VideoScene,
  VideoAspectRatio,
  VideoQuote,
} from "../types";
import RemakeModeSwitch from "../components/RemakeModeSwitch";

// Trang "Dựng video" — mảnh CUỐI khép kín vòng sản phẩm: biến một bản viết
// (Viết lại) thành video. Quy trình 4 bước CÓ ĐIỂM DỪNG vì bước 3 (dựng
// hình bằng AI) tốn tiền thật:
//   1. Tạo dự án + tách cảnh   — miễn phí, chạy nền (~20-40s)
//   2. Người dùng sửa/duyệt cảnh — ĐIỂM DỪNG quan trọng nhất, không tự động
//   3. Dựng hình bằng AI        — TỐN TIỀN, chỉ chạy khi người dùng xác nhận
//   4. Ghép thành video hoàn chỉnh — miễn phí, chạy nền
// Theo dõi tiến độ tái dùng đúng cơ chế poll của Channels/Remake
// (services/videos.ts::pollVideo, port từ pollRemake).

const PROJECT_STATUS_META: Record<VideoProject["status"], { label: string; cls: string }> = {
  draft: { label: "Nháp", cls: "" },
  splitting: { label: "Đang tách cảnh...", cls: "ds-badge-warning" },
  scenes_ready: { label: "Đã tách cảnh", cls: "ds-badge-info" },
  generating: { label: "Đang dựng hình...", cls: "ds-badge-warning" },
  rendering: { label: "Đang ghép video...", cls: "ds-badge-warning" },
  ready: { label: "Hoàn tất", cls: "ds-badge-success" },
  error: { label: "Lỗi", cls: "ds-badge-danger" },
};

const SCENE_STATUS_META: Record<VideoScene["status"], { label: string; cls: string }> = {
  pending: { label: "Chưa dựng", cls: "" },
  generating: { label: "Đang dựng...", cls: "ds-badge-warning" },
  ready: { label: "Đã xong", cls: "ds-badge-success" },
  error: { label: "Lỗi", cls: "ds-badge-danger" },
};

const REMAKE_FORMAT_LABEL: Record<RemakeFormat, string> = {
  video_script: "Kịch bản video",
  post: "Bài đăng",
};

function formatUsd(n: number): string {
  return `${n.toLocaleString("vi-VN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("vi-VN");
}

// clipKey/finalVideoKey là khoá thô trong storage (không có tiền tố) —
// dựng lại thành "/api/files/<key>" rồi mới đính token qua imageDisplayUrl.
function fileUrl(key: string | null | undefined): string | null {
  if (!key) return null;
  return imageDisplayUrl(`/api/files/${key}`);
}

export default function Videos() {
  // Danh sách dự án + dự án đang xem.
  const [items, setItems] = useState<VideoProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<VideoProjectDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VideoProject | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Dữ liệu cho form tạo mới (nguồn: bản viết đã có nội dung).
  const [remakes, setRemakes] = useState<RemakeRow[]>([]);
  const [remakesLoading, setRemakesLoading] = useState(true);

  // Theo dõi dự án đang chạy nền (tách cảnh / dựng hình / ghép) — TÁI DÙNG
  // đúng cơ chế của Channels/Remake: ref cho hàm huỷ để cleanup chắc chắn,
  // đếm giây riêng để hiện "...(Ns)".
  const stopPollRef = useRef<(() => void) | null>(null);
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [watchElapsedSec, setWatchElapsedSec] = useState(0);
  const [watchTimedOut, setWatchTimedOut] = useState(false);

  useEffect(() => {
    (async () => {
      setRemakesLoading(true);
      try {
        setRemakes(await listRemakes());
      } catch {
        // Lỗi tải bản viết hiện qua form (danh sách rỗng) — không chặn cả trang.
      } finally {
        setRemakesLoading(false);
      }
    })();
  }, []);

  async function reloadList() {
    setLoading(true);
    setListError(null);
    try {
      setItems(await listVideos());
    } catch (e: any) {
      setListError(e?.message || "Lỗi tải danh sách dự án video.");
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

  function syncProjectInList(row: VideoProject) {
    setItems((prev) => prev.map((it) => (it.id === row.id ? { ...it, ...row } : it)));
  }

  function startWatching(id: string) {
    stopWatching();
    setWatchTimedOut(false);
    const startedAt = Date.now();
    setWatchElapsedSec(0);
    tickTimerRef.current = setInterval(() => {
      setWatchElapsedSec(Math.round((Date.now() - startedAt) / 1000));
    }, 1000);
    stopPollRef.current = pollVideo(id, {
      onUpdate: (d) => {
        setDetail(d);
        syncProjectInList(d);
        if (!isVideoBusy(d.status)) stopWatching();
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

  async function loadAndWatch(id: string) {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const d = await getVideo(id);
      setDetail(d);
      syncProjectInList(d);
      if (isVideoBusy(d.status)) startWatching(id);
    } catch (e: any) {
      setDetailError(e?.message || "Không tải được dự án video.");
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

  async function handleCreated(row: VideoProject) {
    setItems((prev) => [row, ...prev]);
    setSelectedId(row.id);
  }

  function handleSceneUpdated(updated: VideoScene) {
    setDetail((prev) => (prev ? { ...prev, scenes: prev.scenes.map((s) => (s.id === updated.id ? updated : s)) } : prev));
  }

  async function handleGenerated(result: VideoProject) {
    setDetail((prev) => (prev ? { ...prev, ...result } : prev));
    syncProjectInList(result);
    if (isVideoBusy(result.status)) startWatching(result.id);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteVideo(deleteTarget.id);
      setItems((prev) => prev.filter((it) => it.id !== deleteTarget.id));
      if (selectedId === deleteTarget.id) setSelectedId(null);
      setDeleteTarget(null);
    } catch (e: any) {
      setListError(e?.message || "Xoá dự án video thất bại.");
    } finally {
      setDeleting(false);
    }
  }

  const readyRemakes = remakes.filter((r) => r.status === "ready" && !!r.draft?.trim());

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-bold text-stone-800 font-display flex items-center gap-2">
          <Clapperboard className="w-5 h-5 text-storm-500" aria-hidden="true" /> Remake video
        </h1>
        <p className="text-sm text-stone-500">
          Biến một bản viết thành video: tách cảnh (miễn phí) → bạn sửa/duyệt từng cảnh → dựng hình bằng AI (tốn phí, cần xác
          nhận) → ghép thành video hoàn chỉnh (miễn phí). Bước này <strong>cần sẵn một bản Remake bài viết đã duyệt</strong> —
          chưa có thì quay lại bước trước.
        </p>
      </div>

      <RemakeModeSwitch current="video" />

      <NewVideoForm remakes={readyRemakes} remakesLoading={remakesLoading} onCreated={handleCreated} />

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
          ) : items.length === 0 ? (
            <div className="ds-card">
              <div className="ds-empty">
                <div className="ds-empty-icon">
                  <Film className="w-8 h-8" aria-hidden="true" />
                </div>
                <p className="ds-empty-title">Chưa có dự án video nào</p>
                <p className="ds-empty-desc">Điền form ở trên để dựng video đầu tiên từ một bản viết.</p>
              </div>
            </div>
          ) : (
            items.map((it) => (
              <button
                key={it.id}
                onClick={() => setSelectedId(it.id)}
                className={`text-left rounded-xl border px-3 py-2.5 transition-colors ${
                  selectedId === it.id ? "border-storm-400 bg-storm-50" : "border-stone-200 bg-white hover:border-stone-300"
                }`}
              >
                <span className="text-sm font-semibold text-stone-800 truncate block">{it.title || "Video chưa đặt tên"}</span>
                <div className="flex items-center gap-1.5 flex-wrap mt-1">
                  <span className={`ds-badge ${PROJECT_STATUS_META[it.status].cls}`}>{PROJECT_STATUS_META[it.status].label}</span>
                  <span className="text-[10px] text-stone-400 flex items-center gap-0.5">
                    {it.aspectRatio === "9:16" ? (
                      <Smartphone className="w-2.5 h-2.5" aria-hidden="true" />
                    ) : (
                      <RectangleHorizontal className="w-2.5 h-2.5" aria-hidden="true" />
                    )}
                    {it.aspectRatio}
                  </span>
                </div>
                <div className="text-[10px] text-stone-400 mt-1 flex items-center gap-1">
                  <Clock className="w-2.5 h-2.5" aria-hidden="true" /> {formatDate(it.createdAt)}
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
                  <Clapperboard className="w-8 h-8" aria-hidden="true" />
                </div>
                <p className="ds-empty-title">Chưa chọn dự án</p>
                <p className="ds-empty-desc">Chọn một dự án bên trái để sửa cảnh và dựng video, hoặc tạo dự án mới ở trên.</p>
              </div>
            </div>
          ) : detail ? (
            <>
              {detailError && (
                <div role="alert" className="ds-alert ds-alert-danger mb-3">
                  {detailError}
                </div>
              )}
              <VideoDetailPanel
                key={detail.id}
                detail={detail}
                watching={isVideoBusy(detail.status)}
                watchElapsedSec={watchElapsedSec}
                watchTimedOut={watchTimedOut}
                onRequestDelete={() => setDeleteTarget(detail)}
                onSceneUpdated={handleSceneUpdated}
                onGenerated={handleGenerated}
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
        title="Xoá dự án video?"
        message={`Xoá dự án "${deleteTarget?.title || "Video chưa đặt tên"}" cùng toàn bộ cảnh và video đã dựng? Không thể hoàn tác.${
          deleting ? " Đang xoá..." : ""
        }`}
        confirmText="Xoá"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function NewVideoForm({
  remakes,
  remakesLoading,
  onCreated,
}: {
  remakes: RemakeRow[];
  remakesLoading: boolean;
  onCreated: (row: VideoProject) => void;
}) {
  const [mode, setMode] = useState<"remake" | "script">("remake");
  const [remakeId, setRemakeId] = useState("");
  const [script, setScript] = useState("");
  const [title, setTitle] = useState("");
  const [aspectRatio, setAspectRatio] = useState<VideoAspectRatio>("9:16");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const noRemake = !remakesLoading && remakes.length === 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === "remake" && !remakeId) {
      setError("Chọn một bản viết để dựng thành video.");
      return;
    }
    if (mode === "script" && !script.trim()) {
      setError("Dán nội dung kịch bản muốn dựng thành video.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await createVideo(
        mode === "remake"
          ? { remakeId, title: title.trim() || undefined, aspectRatio }
          : { script: script.trim(), title: title.trim() || undefined, aspectRatio },
      );
      const { polling, message, note, ...row } = result;
      void polling;
      void message;
      void note;
      onCreated(row);
      setScript("");
      setTitle("");
      setRemakeId("");
    } catch (e: any) {
      setError(e?.message || "Tạo dự án video thất bại.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="ds-card">
      <div className="ds-card-body flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMode("remake")}
            className={`ds-btn ds-btn-sm ${mode === "remake" ? "ds-btn-primary" : ""}`}
          >
            Từ bản viết
          </button>
          <button
            type="button"
            onClick={() => setMode("script")}
            className={`ds-btn ds-btn-sm ${mode === "script" ? "ds-btn-primary" : ""}`}
          >
            Dán kịch bản tay
          </button>
        </div>

        {mode === "remake" ? (
          remakesLoading ? (
            <div className="flex items-center gap-2 text-stone-400 text-xs py-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Đang tải danh sách bản viết...
            </div>
          ) : noRemake ? (
            <p className="text-xs text-stone-400 flex items-center gap-1">
              <PenLine className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              Chưa có bản viết nào có nội dung —{" "}
              <Link to="/remakes" className="text-storm-700 hover:underline font-medium">
                viết lại một bài
              </Link>{" "}
              trước, hoặc dán kịch bản tay bên trên.
            </p>
          ) : (
            <div>
              <label htmlFor="vd-remake" className="ds-label">
                Bản viết nguồn
              </label>
              <select id="vd-remake" value={remakeId} onChange={(e) => setRemakeId(e.target.value)} disabled={submitting} className="ds-select">
                <option value="">— Chọn bản viết —</option>
                {remakes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {(r.sourceTitle || REMAKE_FORMAT_LABEL[r.format]) + ` (${REMAKE_FORMAT_LABEL[r.format]})`}
                  </option>
                ))}
              </select>
            </div>
          )
        ) : (
          <div>
            <label htmlFor="vd-script" className="ds-label">
              Kịch bản
            </label>
            <textarea
              id="vd-script"
              value={script}
              onChange={(e) => setScript(e.target.value)}
              disabled={submitting}
              rows={4}
              placeholder="Dán lời dẫn / kịch bản muốn dựng thành video..."
              className="ds-textarea"
            />
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 min-w-0">
            <label htmlFor="vd-title" className="ds-label">
              Tên dự án (không bắt buộc)
            </label>
            <input
              id="vd-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={submitting}
              placeholder="Vd: Video giới thiệu ưu đãi tháng 9"
              className="ds-input"
            />
          </div>
          <div className="shrink-0">
            <span className="ds-label">Khung hình</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setAspectRatio("9:16")}
                disabled={submitting}
                aria-pressed={aspectRatio === "9:16"}
                className={`ds-btn ds-btn-sm ${aspectRatio === "9:16" ? "ds-btn-primary" : ""}`}
              >
                <Smartphone className="w-3.5 h-3.5" aria-hidden="true" /> Dọc (9:16)
              </button>
              <button
                type="button"
                onClick={() => setAspectRatio("16:9")}
                disabled={submitting}
                aria-pressed={aspectRatio === "16:9"}
                className={`ds-btn ds-btn-sm ${aspectRatio === "16:9" ? "ds-btn-primary" : ""}`}
              >
                <RectangleHorizontal className="w-3.5 h-3.5" aria-hidden="true" /> Ngang (16:9)
              </button>
            </div>
          </div>
        </div>

        <div>
          <button type="submit" disabled={submitting} className="ds-btn ds-btn-primary shrink-0">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Plus className="w-4 h-4" aria-hidden="true" />}
            {submitting ? "Đang tạo..." : "Tạo dự án và tách cảnh"}
          </button>
        </div>

        {error && (
          <div role="alert" className="ds-alert ds-alert-danger">
            {error}
          </div>
        )}
        {submitting && (
          <div className="ds-alert ds-alert-warning">
            <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden="true" />
            Đang tách kịch bản thành cảnh, mất khoảng 20-40 giây — bước này chưa tốn phí.
          </div>
        )}
      </div>
    </form>
  );
}

function VideoDetailPanel({
  detail,
  watching,
  watchElapsedSec,
  watchTimedOut,
  onRequestDelete,
  onSceneUpdated,
  onGenerated,
}: {
  detail: VideoProjectDetail;
  watching: boolean;
  watchElapsedSec: number;
  watchTimedOut: boolean;
  onRequestDelete: () => void;
  onSceneUpdated: (scene: VideoScene) => void;
  onGenerated: (project: VideoProject) => void;
}) {
  const [quote, setQuote] = useState<VideoQuote | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [noChargeNote, setNoChargeNote] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);

  const scenes = detail.scenes || [];
  const readyScenes = scenes.filter((s) => !!s.clipKey).length;
  const editable = !watching;
  const meta = PROJECT_STATUS_META[detail.status];

  // Bước sinh hình tốn tiền thật — gọi /quote lấy số mới nhất rồi hiện hộp
  // xác nhận. TUYỆT ĐỐI không gọi /generate ngầm.
  async function openGenerateConfirm() {
    setNoChargeNote(null);
    setGenerateError(null);
    setQuoting(true);
    setQuoteError(null);
    try {
      const q = await getVideoQuote(detail.id);
      if (q.pendingScenes === 0) {
        setNoChargeNote("Mọi cảnh đã có hình — không cần dựng lại, không tốn thêm phí.");
        return;
      }
      setQuote(q);
    } catch (e: any) {
      setQuoteError(e?.message || "Không ước tính được chi phí.");
    } finally {
      setQuoting(false);
    }
  }

  async function confirmGenerate() {
    setQuote(null);
    setGenerating(true);
    setGenerateError(null);
    try {
      const result = await generateVideoScenes(detail.id);
      const { polling, message, willGenerate, estimatedCostUsd, ...row } = result;
      void polling;
      void message;
      void willGenerate;
      void estimatedCostUsd;
      onGenerated(row);
    } catch (e: any) {
      setGenerateError(e?.message || "Không dựng được hình.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleRender() {
    setRendering(true);
    setRenderError(null);
    try {
      const result = await renderVideo(detail.id);
      const { polling, message, ...row } = result;
      void polling;
      void message;
      onGenerated(row);
    } catch (e: any) {
      setRenderError(e?.message || "Không ghép được video.");
    } finally {
      setRendering(false);
    }
  }

  const finalUrl = fileUrl(detail.finalVideoKey);

  return (
    <div className="flex flex-col gap-4">
      <div className="ds-card">
        <div className="ds-card-body">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-bold text-stone-800 font-display truncate">{detail.title || "Video chưa đặt tên"}</h2>
              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                <span className={`ds-badge ${meta.cls}`}>{meta.label}</span>
                <span className="text-[11px] text-stone-400 flex items-center gap-0.5">
                  {detail.aspectRatio === "9:16" ? (
                    <Smartphone className="w-3 h-3" aria-hidden="true" />
                  ) : (
                    <RectangleHorizontal className="w-3 h-3" aria-hidden="true" />
                  )}
                  {detail.aspectRatio}
                </span>
                <span className="text-[11px] text-stone-400">{formatDate(detail.createdAt)}</span>
                {scenes.length > 0 && (
                  <span className="text-[11px] text-stone-400">
                    Đã có hình {readyScenes}/{scenes.length} cảnh
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={onRequestDelete}
              className="flex items-center gap-1 text-xs font-medium text-red-600 hover:bg-red-50 px-2.5 py-1.5 rounded-lg transition-colors shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" /> Xoá dự án
            </button>
          </div>

          {watchTimedOut ? (
            <div role="alert" className="ds-alert ds-alert-danger mt-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
              Quá lâu không có phản hồi, thử tải lại trang.
            </div>
          ) : detail.status === "splitting" ? (
            <div className="ds-alert ds-alert-warning mt-2">
              <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" aria-hidden="true" />
              Đang tách kịch bản thành cảnh... ({watchElapsedSec}s) — bước này chưa tốn phí.
            </div>
          ) : detail.status === "generating" ? (
            <div className="ds-alert ds-alert-warning mt-2 flex-col !items-stretch gap-2">
              <span className="flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" aria-hidden="true" />
                Đang dựng hình — đã xong {readyScenes}/{scenes.length} cảnh ({watchElapsedSec}s). Mỗi cảnh mất 1-3 phút.
              </span>
              <div className="h-1.5 w-full rounded-full bg-white/60 overflow-hidden">
                <div
                  className="h-full bg-amber-500 transition-all"
                  style={{ width: `${scenes.length ? Math.round((readyScenes / scenes.length) * 100) : 0}%` }}
                />
              </div>
            </div>
          ) : detail.status === "rendering" ? (
            <div className="ds-alert ds-alert-warning mt-2">
              <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" aria-hidden="true" />
              Đang ghép các cảnh thành một video... ({watchElapsedSec}s)
            </div>
          ) : null}

          {detail.status === "error" && detail.errorMessage && (
            <div role="alert" className="ds-alert ds-alert-danger mt-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
              {detail.errorMessage}
            </div>
          )}
        </div>
      </div>

      {/* ===== Bước 2 — TRUNG TÂM màn hình: sửa/duyệt từng cảnh ===== */}
      {scenes.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-stone-700 px-1">Các cảnh ({scenes.length})</h3>
          {scenes.map((scene, i) => (
            <SceneEditor key={scene.id} scene={scene} index={i} projectId={detail.id} disabled={!editable} onSaved={onSceneUpdated} />
          ))}
        </div>
      )}

      {/* ===== Bước 3 — dựng hình bằng AI (TỐN TIỀN, cần xác nhận) ===== */}
      {scenes.length > 0 && (
        <div className="ds-card">
          <div className="ds-card-body flex flex-col gap-2.5">
            <h3 className="text-sm font-semibold text-stone-700 flex items-center gap-1.5">
              <Wand2 className="w-4 h-4 text-storm-500" aria-hidden="true" /> Dựng hình bằng AI
            </h3>
            <p className="text-xs text-stone-500">
              Còn {detail.pendingScenes} cảnh chưa có hình, ước tính {formatUsd(detail.estimatedCostUsd)} ({formatUsd(detail.usdPerScene)}
              /cảnh). Cảnh đã có hình sẽ được giữ nguyên, không tính tiền lần hai.
            </p>
            <div>
              <button
                type="button"
                onClick={openGenerateConfirm}
                disabled={!editable || quoting || generating || detail.pendingScenes === 0}
                className="ds-btn ds-btn-primary shrink-0"
              >
                {quoting || generating ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Wand2 className="w-4 h-4" aria-hidden="true" />}
                {generating ? "Đang gửi yêu cầu..." : quoting ? "Đang tính chi phí..." : "Dựng hình bằng AI"}
              </button>
            </div>
            {noChargeNote && (
              <div className="ds-alert ds-alert-success">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                {noChargeNote}
              </div>
            )}
            {quoteError && (
              <div role="alert" className="ds-alert ds-alert-danger">
                {quoteError}
              </div>
            )}
            {generateError && (
              <div role="alert" className="ds-alert ds-alert-danger">
                {generateError}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== Bước 4 — ghép thành video hoàn chỉnh (miễn phí) ===== */}
      {scenes.length > 0 && (
        <div className="ds-card">
          <div className="ds-card-body flex flex-col gap-2.5">
            <h3 className="text-sm font-semibold text-stone-700 flex items-center gap-1.5">
              <FileVideo className="w-4 h-4 text-storm-500" aria-hidden="true" /> Video hoàn chỉnh
            </h3>
            {readyScenes === 0 ? (
              <p className="text-xs text-stone-400">Cần dựng hình ít nhất một cảnh trước khi ghép thành video.</p>
            ) : (
              <div>
                <button
                  type="button"
                  onClick={handleRender}
                  disabled={!editable || rendering}
                  className="ds-btn shrink-0"
                  title={readyScenes < scenes.length ? "Chỉ những cảnh đã có hình sẽ được ghép." : undefined}
                >
                  {rendering ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <FileVideo className="w-4 h-4" aria-hidden="true" />}
                  {rendering ? "Đang ghép..." : detail.finalVideoKey ? "Ghép lại video hoàn chỉnh" : "Ghép thành video hoàn chỉnh"}
                </button>
                {readyScenes < scenes.length && (
                  <p className="text-[11px] text-stone-400 mt-1.5">
                    Ghép miễn phí — chỉ {readyScenes}/{scenes.length} cảnh đã có hình sẽ được dùng, phần còn lại sẽ thiếu trong video.
                  </p>
                )}
              </div>
            )}
            {renderError && (
              <div role="alert" className="ds-alert ds-alert-danger">
                {renderError}
              </div>
            )}
            {finalUrl && (
              <div className="flex flex-col gap-2 mt-1">
                <video controls src={finalUrl} className="w-full max-w-md rounded-lg border border-stone-200 bg-black" />
                <a href={finalUrl} download={`${detail.title || "video"}.mp4`} className="ds-btn ds-btn-sm self-start">
                  <Download className="w-3.5 h-3.5" aria-hidden="true" /> Tải video hoàn chỉnh
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={!!quote}
        title="Xác nhận chi phí dựng hình"
        message={
          quote
            ? `Dựng hình cho ${quote.pendingScenes} cảnh, ước tính khoảng ${formatUsd(quote.estimatedCostUsd)} (${formatUsd(
                quote.usdPerScene,
              )}/cảnh). Đây là chi phí thật. Cảnh đã có hình sẽ không bị dựng lại nên không tính tiền lần hai. Tiếp tục?`
            : ""
        }
        confirmText="Đồng ý, dựng hình"
        cancelText="Thôi"
        onConfirm={confirmGenerate}
        onCancel={() => setQuote(null)}
      />
    </div>
  );
}

function SceneEditor({
  scene,
  index,
  projectId,
  disabled,
  onSaved,
}: {
  scene: VideoScene;
  index: number;
  projectId: string;
  disabled: boolean;
  onSaved: (scene: VideoScene) => void;
}) {
  const [narration, setNarration] = useState(scene.narration || "");
  const [visualPrompt, setVisualPrompt] = useState(scene.visualPrompt || "");
  const [durationSec, setDurationSec] = useState(scene.durationSec);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setNarration(scene.narration || "");
    setVisualPrompt(scene.visualPrompt || "");
    setDurationSec(scene.durationSec);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene.id, scene.updatedAt]);

  const dirty = narration !== (scene.narration || "") || visualPrompt !== (scene.visualPrompt || "") || durationSec !== scene.durationSec;
  const willLoseClip = !!scene.clipKey && visualPrompt !== (scene.visualPrompt || "");
  const clipUrl = fileUrl(scene.clipKey);
  const sMeta = SCENE_STATUS_META[scene.status];

  async function handleSave() {
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const patch: PatchSceneInput = {};
      if (narration !== (scene.narration || "")) patch.narration = narration;
      if (visualPrompt !== (scene.visualPrompt || "")) patch.visualPrompt = visualPrompt;
      if (durationSec !== scene.durationSec) patch.durationSec = durationSec;
      const updated = await patchScene(projectId, scene.id, patch);
      onSaved(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      setError(e?.message || "Không lưu được thay đổi.");
    } finally {
      setSaving(false);
    }
  }

  const fieldsDisabled = disabled || saving;

  return (
    <div className="ds-card">
      <div className="ds-card-body flex flex-col gap-2.5">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <span className="text-sm font-semibold text-stone-700">Cảnh {index + 1}</span>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={`ds-badge ${sMeta.cls}`}>{sMeta.label}</span>
            {scene.clipKey && (
              <span className="ds-badge ds-badge-info">
                <CheckCircle2 className="w-3 h-3" aria-hidden="true" /> Đã có hình
              </span>
            )}
          </div>
        </div>

        {scene.status === "error" && scene.errorMessage && (
          <div role="alert" className="ds-alert ds-alert-danger">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
            {scene.errorMessage}
          </div>
        )}

        <div className="flex flex-col md:flex-row gap-3">
          <div className="flex-1 min-w-0 flex flex-col gap-2.5">
            <div>
              <label htmlFor={`scene-narration-${scene.id}`} className="ds-label">
                Lời dẫn
              </label>
              <textarea
                id={`scene-narration-${scene.id}`}
                value={narration}
                onChange={(e) => setNarration(e.target.value)}
                disabled={fieldsDisabled}
                rows={2}
                className="ds-textarea"
              />
            </div>
            <div>
              <label htmlFor={`scene-prompt-${scene.id}`} className="ds-label">
                Mô tả hình (tiếng Anh, gửi cho AI để dựng)
              </label>
              <textarea
                id={`scene-prompt-${scene.id}`}
                value={visualPrompt}
                onChange={(e) => setVisualPrompt(e.target.value)}
                disabled={fieldsDisabled}
                rows={2}
                className="ds-textarea"
              />
              {scene.clipKey && (
                <p className="ds-hint flex items-start gap-1">
                  <Info className="w-3 h-3 shrink-0 mt-0.5" aria-hidden="true" />
                  Cảnh này đã có hình. Đổi mô tả hình sẽ xoá clip cũ, cảnh sẽ cần dựng lại.
                </p>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div>
                <label htmlFor={`scene-duration-${scene.id}`} className="ds-label">
                  Thời lượng (giây)
                </label>
                <input
                  id={`scene-duration-${scene.id}`}
                  type="number"
                  min={3}
                  max={10}
                  value={durationSec}
                  onChange={(e) => setDurationSec(Math.max(3, Math.min(10, Number(e.target.value) || 3)))}
                  disabled={fieldsDisabled}
                  className="ds-input w-24"
                />
              </div>
              <div className="flex items-end h-full pb-[1px]">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={!dirty || fieldsDisabled}
                  className="ds-btn ds-btn-sm"
                  title={willLoseClip ? "Lưu sẽ xoá clip cũ của cảnh này" : undefined}
                >
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Save className="w-3.5 h-3.5" aria-hidden="true" />}
                  {saving ? "Đang lưu..." : "Lưu"}
                </button>
              </div>
              {saved && (
                <span className="text-xs text-green-700 flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> Đã lưu
                </span>
              )}
            </div>
            {error && (
              <div role="alert" className="ds-alert ds-alert-danger">
                {error}
              </div>
            )}
          </div>

          {(clipUrl || scene.status === "generating") && (
            <div className="w-full md:w-48 shrink-0 flex flex-col gap-1.5">
              {clipUrl ? (
                <>
                  <video controls src={clipUrl} className="w-full rounded-lg border border-stone-200 bg-black aspect-[9/16] object-cover" />
                  <a href={clipUrl} download={`canh-${index + 1}.mp4`} className="ds-btn ds-btn-sm justify-center">
                    <Download className="w-3.5 h-3.5" aria-hidden="true" /> Tải cảnh
                  </a>
                </>
              ) : (
                <div className="w-full aspect-[9/16] rounded-lg border border-dashed border-stone-200 bg-stone-50 flex items-center justify-center text-stone-300">
                  <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 text-[11px] text-stone-400">
          <DollarSign className="w-3 h-3" aria-hidden="true" />
          {scene.clipKey ? "Cảnh này đã dựng — không tính phí nếu dựng lại toàn bộ dự án." : "Cảnh này chưa dựng hình."}
        </div>
      </div>
    </div>
  );
}
