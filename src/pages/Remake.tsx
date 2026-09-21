import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Loader2,
  Trash2,
  ExternalLink,
  AlertTriangle,
  PenLine,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Send,
  RotateCcw,
  Scissors,
} from "lucide-react";
import { listBrands } from "../services/brands";
import { listDeconstructions } from "../services/deconstruct";
import { listRemakes, getRemake, createRemake, reviseRemake, recheckRemake, deleteRemake, pollRemake } from "../services/remakes";
import ConfirmDialog from "../components/ConfirmDialog";
import type { BrandRow, DeconstructionRow, RemakeRow, RemakeFormat, GuardrailReport, GuardrailIssue, GuardrailCode } from "../types";

// Trang "Viết lại" — màn CUỐI khép kín vòng sản phẩm: tìm bài (Radar) → bóc
// cấu trúc (Bóc cấu trúc) → viết lại cho thương hiệu (ở đây) → kiểm tra.
// LINH HỒN màn này: kết quả kiểm tra (guardrail) phải nổi bật nhất — người
// dùng PHẢI thấy bản viết còn vi phạm gì trước khi đem dùng. Theo dõi tiến độ
// dùng lại đúng cơ chế poll của Deconstruct (services/remakes.ts::pollRemake,
// port từ pollDeconstruction).
const STATUS_META: Record<RemakeRow["status"], { label: string; cls: string }> = {
  pending: { label: "Đang chờ", cls: "bg-stone-100 text-stone-500" },
  writing: { label: "Đang viết...", cls: "bg-amber-50 text-amber-700" },
  ready: { label: "Đã có bản viết", cls: "bg-green-50 text-green-700" },
  error: { label: "Lỗi", cls: "bg-red-50 text-red-600" },
};

const FORMAT_LABEL: Record<RemakeFormat, string> = {
  video_script: "Kịch bản video",
  post: "Bài đăng",
};

const GUARDRAIL_CODE_LABEL: Record<GuardrailCode, string> = {
  copied_text: "Bê nguyên văn bài gốc",
  unverified_claim: "Khẳng định chưa có căn cứ",
  banned_term: "Dùng từ thương hiệu đã tránh",
  wrong_addressing: "Xưng hô chưa đúng kiểu",
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("vi-VN");
}

export default function Remake() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Dữ liệu cho form tạo mới.
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [brandsLoading, setBrandsLoading] = useState(true);
  const [deconRows, setDeconRows] = useState<DeconstructionRow[]>([]);
  const [deconLoading, setDeconLoading] = useState(true);

  // Danh sách bản viết + bản đang xem.
  const [items, setItems] = useState<RemakeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RemakeRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RemakeRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Gợi ý "hồ sơ thương hiệu còn trống" — chỉ trả về lúc tạo mới, không nằm
  // trong bản ghi, nên giữ tạm ở state gắn với id để hiện đúng chỗ.
  const [pendingHint, setPendingHint] = useState<{ id: string; message: string } | null>(null);

  // Form tạo bản viết mới — điền sẵn từ ?deconstructionId= (nút "Viết lại cho
  // thương hiệu" ở trang Bóc cấu trúc) như Deconstruct đang làm với radarItemId.
  const [formBrandId, setFormBrandId] = useState("");
  const [formDeconId, setFormDeconId] = useState("");
  const [formFormat, setFormFormat] = useState<RemakeFormat>("video_script");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Sửa tay + kiểm tra lại (đồng bộ).
  const [rechecking, setRechecking] = useState(false);
  const [recheckError, setRecheckError] = useState<string | null>(null);

  // Yêu cầu chỉnh bằng lời (chạy nền, theo dõi bằng poll).
  const [revising, setRevising] = useState(false);
  const [reviseError, setReviseError] = useState<string | null>(null);

  // Theo dõi bản đang viết/chỉnh (chạy nền ở backend) — TÁI DÙNG đúng cơ chế
  // của Deconstruct: ref cho "hàm huỷ" (không phải state) để startWatching()
  // luôn tự huỷ lượt theo dõi trước đó, và effect đổi selectedId bên dưới đảm
  // bảo dọn timer khi đổi bản xem / rời trang.
  const stopPollRef = useRef<(() => void) | null>(null);
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [watchElapsedSec, setWatchElapsedSec] = useState(0);
  const [watchTimedOut, setWatchTimedOut] = useState(false);

  useEffect(() => {
    (async () => {
      setBrandsLoading(true);
      try {
        setBrands(await listBrands());
      } catch {
        // Lỗi tải thương hiệu hiện qua form (danh sách rỗng) — không chặn cả trang.
      } finally {
        setBrandsLoading(false);
      }
    })();
    (async () => {
      setDeconLoading(true);
      try {
        setDeconRows(await listDeconstructions());
      } catch {
        // Tương tự — form tự xử lý trường hợp rỗng.
      } finally {
        setDeconLoading(false);
      }
    })();
  }, []);

  async function reloadList() {
    setLoading(true);
    setListError(null);
    try {
      setItems(await listRemakes());
    } catch (e: any) {
      setListError(e?.message || "Lỗi tải danh sách bản viết.");
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

  function syncItemInList(row: RemakeRow) {
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
    stopPollRef.current = pollRemake(id, {
      onUpdate: (r) => {
        setDetail(r);
        syncItemInList(r);
        if (r.status === "ready" || r.status === "error") stopWatching();
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
      const r = await getRemake(id);
      setDetail(r);
      syncItemInList(r);
      if (r.status === "pending" || r.status === "writing") startWatching(id);
    } catch (e: any) {
      setDetailError(e?.message || "Không tải được bản viết.");
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    // Xoá dữ liệu bản cũ ngay khi đổi lựa chọn — tránh thoáng hiện nhầm nội
    // dung của bản trước trong lúc đang tải bản mới.
    setDetail(null);
    setDetailError(null);
    setRecheckError(null);
    setReviseError(null);
    if (selectedId) loadAndWatch(selectedId);
    // Dọn theo dõi (poll + đếm giây) khi đổi bản xem HOẶC rời trang — đây là
    // chỗ dễ rò rỉ timer nhất nếu quên.
    return () => stopWatching();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Điền sẵn form từ ?deconstructionId= rồi xoá tham số khỏi URL — không tự
  // gửi (khác Deconstruct với radarItemId): người dùng còn phải chọn thương
  // hiệu + dạng trước khi bấm viết.
  const consumedDeconIdRef = useRef(false);
  useEffect(() => {
    const id = searchParams.get("deconstructionId");
    if (!id || consumedDeconIdRef.current) return;
    consumedDeconIdRef.current = true;
    setFormDeconId(id);
    setSearchParams(
      (p) => {
        p.delete("deconstructionId");
        return p;
      },
      { replace: true },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!formBrandId) {
      setCreateError("Chọn thương hiệu muốn viết cho.");
      return;
    }
    if (!formDeconId) {
      setCreateError("Chọn bài đã bóc cấu trúc để học theo.");
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const result = await createRemake({ brandId: formBrandId, deconstructionId: formDeconId, format: formFormat });
      const { polling, message, hint, ...row } = result;
      void polling;
      void message;
      setItems((prev) => [row, ...prev]);
      setSelectedId(row.id);
      setPendingHint(hint ? { id: row.id, message: hint } : null);
    } catch (e: any) {
      setCreateError(e?.message || "Bắt đầu viết thất bại.");
    } finally {
      setCreating(false);
    }
  }

  async function handleRecheck(draftText: string) {
    if (!detail) return;
    setRechecking(true);
    setRecheckError(null);
    try {
      const updated = await recheckRemake(detail.id, draftText);
      setDetail(updated);
      syncItemInList(updated);
    } catch (e: any) {
      setRecheckError(e?.message || "Kiểm tra lại thất bại.");
    } finally {
      setRechecking(false);
    }
  }

  async function handleRevise(note: string) {
    if (!detail) return;
    setRevising(true);
    setReviseError(null);
    try {
      const result = await reviseRemake(detail.id, note);
      const { polling, message, hint, ...row } = result;
      void polling;
      void message;
      void hint;
      setDetail(row);
      syncItemInList(row);
      startWatching(detail.id);
    } catch (e: any) {
      setReviseError(e?.message || "Gửi yêu cầu chỉnh sửa thất bại.");
    } finally {
      setRevising(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteRemake(deleteTarget.id);
      setItems((prev) => prev.filter((it) => it.id !== deleteTarget.id));
      if (selectedId === deleteTarget.id) setSelectedId(null);
      setDeleteTarget(null);
    } catch (e: any) {
      setListError(e?.message || "Xoá bản viết thất bại.");
    } finally {
      setDeleting(false);
    }
  }

  const readyDeconRows = deconRows.filter((d) => d.status === "ready");

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-bold text-stone-800 font-display flex items-center gap-2">
          <PenLine className="w-5 h-5 text-storm-500" aria-hidden="true" /> Viết lại
        </h1>
        <p className="text-sm text-stone-500">
          Học cách triển khai của một bài đã bóc cấu trúc, viết lại bằng ruột của thương hiệu bạn — rồi kiểm tra kỹ trước khi
          đem dùng.
        </p>
      </div>

      <NewRemakeForm
        brands={brands}
        brandsLoading={brandsLoading}
        deconRows={readyDeconRows}
        deconLoading={deconLoading}
        brandId={formBrandId}
        onBrandIdChange={setFormBrandId}
        deconId={formDeconId}
        onDeconIdChange={setFormDeconId}
        format={formFormat}
        onFormatChange={setFormFormat}
        submitting={creating}
        error={createError}
        onSubmit={handleCreate}
      />

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
          ) : items.length === 0 ? (
            <div className="text-center py-10 text-stone-400 text-sm border border-dashed border-stone-300 rounded-xl">
              Chưa có bản viết nào. Điền form ở trên để bắt đầu.
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
                <span className="text-sm font-semibold text-stone-800 truncate block">{it.sourceTitle || FORMAT_LABEL[it.format]}</span>
                <div className="flex items-center gap-1.5 flex-wrap mt-1">
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${STATUS_META[it.status].cls}`}>
                    {STATUS_META[it.status].label}
                  </span>
                  <span className="text-[10px] text-stone-400">{FORMAT_LABEL[it.format]}</span>
                  {it.status === "ready" && it.guardrailJson && (
                    <span title={it.guardrailJson.passed ? "Qua được kiểm tra" : "Còn vấn đề phải sửa"}>
                      {it.guardrailJson.passed ? (
                        <CheckCircle2 className="w-3 h-3 text-green-600" aria-hidden="true" />
                      ) : (
                        <AlertTriangle className="w-3 h-3 text-red-600" aria-hidden="true" />
                      )}
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </aside>

        <div className="flex-1 min-w-0 w-full">
          {!selectedId ? (
            <div className="flex flex-col items-center justify-center text-center gap-2 py-20 text-stone-400 border border-dashed border-stone-300 rounded-2xl bg-white/50">
              <PenLine className="w-8 h-8 text-stone-300" aria-hidden="true" />
              <p className="text-sm">Chọn một bản viết bên trái để xem kết quả, hoặc điền form ở trên để bắt đầu.</p>
            </div>
          ) : detail ? (
            <>
              {detailError && (
                <div role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">
                  {detailError}
                </div>
              )}
              <RemakeDetailPanel
                key={detail.id}
                row={detail}
                watching={detail.status === "pending" || detail.status === "writing"}
                watchElapsedSec={watchElapsedSec}
                watchTimedOut={watchTimedOut}
                hint={pendingHint?.id === detail.id ? pendingHint.message : null}
                onDismissHint={() => setPendingHint(null)}
                onRequestDelete={() => setDeleteTarget(detail)}
                onRecheck={handleRecheck}
                rechecking={rechecking}
                recheckError={recheckError}
                onRevise={handleRevise}
                revising={revising}
                reviseError={reviseError}
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

      <ConfirmDialog
        isOpen={!!deleteTarget}
        title="Xoá bản viết?"
        message={`Xoá bản viết "${deleteTarget?.sourceTitle || FORMAT_LABEL[deleteTarget?.format ?? "video_script"]}"? Không thể hoàn tác.${
          deleting ? " Đang xoá..." : ""
        }`}
        confirmText="Xoá"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function NewRemakeForm({
  brands,
  brandsLoading,
  deconRows,
  deconLoading,
  brandId,
  onBrandIdChange,
  deconId,
  onDeconIdChange,
  format,
  onFormatChange,
  submitting,
  error,
  onSubmit,
}: {
  brands: BrandRow[];
  brandsLoading: boolean;
  deconRows: DeconstructionRow[];
  deconLoading: boolean;
  brandId: string;
  onBrandIdChange: (v: string) => void;
  deconId: string;
  onDeconIdChange: (v: string) => void;
  format: RemakeFormat;
  onFormatChange: (v: RemakeFormat) => void;
  submitting: boolean;
  error: string | null;
  onSubmit: (e: React.FormEvent) => void;
}) {
  const noDecon = !deconLoading && deconRows.length === 0;
  const noBrand = !brandsLoading && brands.length === 0;

  return (
    <form onSubmit={onSubmit} className="bg-white rounded-xl border border-stone-200 p-4 flex flex-col gap-3">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1 min-w-0">
          <label htmlFor="rm-brand" className="block text-xs font-medium text-stone-600 mb-1">
            Thương hiệu
          </label>
          {brandsLoading ? (
            <div className="flex items-center gap-2 text-stone-400 text-xs py-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Đang tải...
            </div>
          ) : noBrand ? (
            <p className="text-xs text-stone-400">
              Chưa có thương hiệu nào —{" "}
              <Link to="/brands" className="text-storm-700 hover:underline font-medium">
                tạo hồ sơ thương hiệu
              </Link>{" "}
              trước.
            </p>
          ) : (
            <select
              id="rm-brand"
              value={brandId}
              onChange={(e) => onBrandIdChange(e.target.value)}
              disabled={submitting}
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm disabled:opacity-60"
            >
              <option value="">— Chọn thương hiệu —</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <label htmlFor="rm-decon" className="block text-xs font-medium text-stone-600 mb-1">
            Bài đã bóc cấu trúc
          </label>
          {deconLoading ? (
            <div className="flex items-center gap-2 text-stone-400 text-xs py-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Đang tải...
            </div>
          ) : noDecon ? (
            <p className="text-xs text-stone-400 flex items-center gap-1">
              <Scissors className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              Chưa có bài nào bóc xong cấu trúc —{" "}
              <Link to="/deconstruct" className="text-storm-700 hover:underline font-medium">
                bóc cấu trúc một bài
              </Link>{" "}
              trước.
            </p>
          ) : (
            <select
              id="rm-decon"
              value={deconId}
              onChange={(e) => onDeconIdChange(e.target.value)}
              disabled={submitting}
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm disabled:opacity-60"
            >
              <option value="">— Chọn bài —</option>
              {deconRows.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title || d.sourceUrl}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="sm:w-48 shrink-0">
          <label htmlFor="rm-format" className="block text-xs font-medium text-stone-600 mb-1">
            Dạng bài
          </label>
          <select
            id="rm-format"
            value={format}
            onChange={(e) => onFormatChange(e.target.value as RemakeFormat)}
            disabled={submitting}
            className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm disabled:opacity-60"
          >
            <option value="video_script">{FORMAT_LABEL.video_script}</option>
            <option value="post">{FORMAT_LABEL.post}</option>
          </select>
        </div>
      </div>

      <div>
        <button
          type="submit"
          disabled={submitting || noBrand || noDecon}
          className="flex items-center justify-center gap-1.5 text-sm font-medium text-white bg-storm-600 hover:bg-storm-700 px-4 py-2 rounded-lg transition-colors disabled:opacity-60 shrink-0"
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <PenLine className="w-4 h-4" aria-hidden="true" />}
          {submitting ? "Đang bắt đầu..." : "Viết bản mới"}
        </button>
      </div>

      {error && (
        <div role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      {submitting && (
        <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
          <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden="true" />
          Việc viết chạy nền, mất khoảng 10-40 giây — kết quả sẽ tự hiện bên dưới.
        </div>
      )}
    </form>
  );
}

function GuardrailBanner({ report }: { report: GuardrailReport | null | undefined }) {
  if (!report) {
    return (
      <div className="flex items-center gap-2 text-sm font-medium text-stone-500 bg-stone-100 border border-stone-200 rounded-xl px-4 py-3">
        <HelpCircle className="w-4.5 h-4.5 shrink-0" aria-hidden="true" /> Chưa kiểm tra
      </div>
    );
  }
  if (report.passed) {
    return (
      <div className="flex items-center gap-2 text-sm font-medium text-green-800 bg-green-50 border-2 border-green-200 rounded-xl px-4 py-3">
        <CheckCircle2 className="w-4.5 h-4.5 shrink-0" aria-hidden="true" />
        Qua được kiểm tra — vẫn nên đọc lại lần cuối trước khi đăng
      </div>
    );
  }
  const blockCount = report.issues.filter((i) => i.severity === "block").length;
  return (
    <div className="flex items-center gap-2 text-sm font-medium text-red-800 bg-red-50 border-2 border-red-200 rounded-xl px-4 py-3">
      <XCircle className="w-4.5 h-4.5 shrink-0" aria-hidden="true" />
      Còn {blockCount} vấn đề phải sửa trước khi dùng
    </div>
  );
}

function IssueCard({ issue }: { issue: GuardrailIssue }) {
  const blocking = issue.severity === "block";
  return (
    <div
      className={`rounded-lg border px-3 py-2.5 flex flex-col gap-1.5 ${
        blocking ? "border-red-200 bg-red-50/60" : "border-amber-200 bg-amber-50/60"
      }`}
    >
      <div className="flex items-center gap-1.5 flex-wrap">
        <span
          className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
            blocking ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
          }`}
        >
          {GUARDRAIL_CODE_LABEL[issue.code]}
        </span>
      </div>
      <p className={`text-sm ${blocking ? "text-red-900" : "text-amber-900"}`}>{issue.message}</p>
      {issue.excerpt && (
        <blockquote className="text-xs text-stone-600 italic border-l-2 border-stone-300 pl-2.5 py-0.5 bg-white/70 rounded-r">
          "{issue.excerpt}"
        </blockquote>
      )}
      {issue.hint && (
        <p className="text-xs text-stone-500">
          <span className="font-medium text-stone-600">Gợi ý:</span> {issue.hint}
        </p>
      )}
    </div>
  );
}

function IssuesList({ report }: { report: GuardrailReport }) {
  const blocking = report.issues.filter((i) => i.severity === "block");
  const warn = report.issues.filter((i) => i.severity === "warn");
  if (blocking.length === 0 && warn.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      {blocking.length > 0 && (
        <div className="flex flex-col gap-2">
          <h4 className="text-xs font-semibold text-red-700">Phải sửa</h4>
          {blocking.map((issue, i) => (
            <IssueCard key={`b-${i}`} issue={issue} />
          ))}
        </div>
      )}
      {warn.length > 0 && (
        <div className="flex flex-col gap-2">
          <h4 className="text-xs font-semibold text-amber-700">Nên xem lại</h4>
          {warn.map((issue, i) => (
            <IssueCard key={`w-${i}`} issue={issue} />
          ))}
        </div>
      )}
    </div>
  );
}

function RemakeDetailPanel({
  row,
  watching,
  watchElapsedSec,
  watchTimedOut,
  hint,
  onDismissHint,
  onRequestDelete,
  onRecheck,
  rechecking,
  recheckError,
  onRevise,
  revising,
  reviseError,
}: {
  row: RemakeRow;
  watching: boolean;
  watchElapsedSec: number;
  watchTimedOut: boolean;
  hint: string | null;
  onDismissHint: () => void;
  onRequestDelete: () => void;
  onRecheck: (draft: string) => void;
  rechecking: boolean;
  recheckError: string | null;
  onRevise: (note: string) => void;
  revising: boolean;
  reviseError: string | null;
}) {
  const [draftText, setDraftText] = useState(row.draft || "");
  const [copied, setCopied] = useState(false);
  const [confirmCopyOpen, setConfirmCopyOpen] = useState(false);
  const [reviseNote, setReviseNote] = useState("");
  const [revisionsOpen, setRevisionsOpen] = useState(false);

  useEffect(() => {
    setDraftText(row.draft || "");
  }, [row.id, row.draft]);

  const editable = row.status === "ready" && !watching && !rechecking && !revising;

  async function doCopy() {
    try {
      await navigator.clipboard.writeText(draftText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard có thể bị chặn (quyền trình duyệt) — im lặng, không chặn UI.
    }
  }

  function handleCopyClick() {
    if (row.guardrailJson && row.guardrailJson.passed === false) {
      setConfirmCopyOpen(true);
      return;
    }
    doCopy();
  }

  function handleReviseSubmit(e: React.FormEvent) {
    e.preventDefault();
    const note = reviseNote.trim();
    if (!note) return;
    onRevise(note);
    setReviseNote("");
  }

  const revisions = row.revisionsJson || [];

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white rounded-xl border border-stone-200 p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-stone-800 font-display truncate">{row.sourceTitle || FORMAT_LABEL[row.format]}</h2>
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${STATUS_META[row.status].cls}`}>
                {STATUS_META[row.status].label}
              </span>
              <span className="text-[11px] text-stone-400">{FORMAT_LABEL[row.format]}</span>
              <span className="text-[11px] text-stone-400">{formatDate(row.createdAt)}</span>
              {row.sourceUrl && (
                <a
                  href={row.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-storm-700 hover:underline inline-flex items-center gap-0.5"
                >
                  Nguồn bài gốc <ExternalLink className="w-3 h-3" aria-hidden="true" />
                </a>
              )}
            </div>
          </div>
          <button
            onClick={onRequestDelete}
            className="flex items-center gap-1 text-xs font-medium text-red-600 hover:bg-red-50 px-2.5 py-1.5 rounded-lg transition-colors shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" /> Xoá bản viết
          </button>
        </div>

        {watchTimedOut ? (
          <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5 mt-2 flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
            Quá lâu không có phản hồi, thử tải lại trang.
          </div>
        ) : watching ? (
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mt-2 flex items-center gap-1.5">
            <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin" aria-hidden="true" />
            Đang viết... ({watchElapsedSec}s)
          </div>
        ) : null}

        {row.status === "error" && row.errorMessage && (
          <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5 mt-2 flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
            {row.errorMessage}
          </div>
        )}

        {hint && (
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mt-2 flex items-start justify-between gap-2">
            <span className="flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
              {hint}
            </span>
            <button onClick={onDismissHint} className="text-amber-500 hover:text-amber-700 shrink-0" aria-label="Đóng gợi ý này">
              ×
            </button>
          </div>
        )}
      </div>

      {row.status === "ready" && (
        <>
          <div className="flex flex-col gap-2">
            <GuardrailBanner report={row.guardrailJson} />
            {row.guardrailJson && row.guardrailJson.stats.maxOverlapWords > 0 && (
              <p className="text-xs text-stone-500 px-1">
                Đoạn trùng dài nhất với bài gốc: {row.guardrailJson.stats.maxOverlapWords} từ.
              </p>
            )}
          </div>

          {row.guardrailJson && <IssuesList report={row.guardrailJson} />}

          <div className="bg-white rounded-xl border border-stone-200 p-4 flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h3 className="text-sm font-semibold text-stone-700">Nội dung bản viết</h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onRecheck(draftText)}
                  disabled={!editable || rechecking}
                  className="flex items-center gap-1.5 text-xs font-medium text-storm-700 hover:bg-storm-100 bg-storm-50 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-40"
                >
                  {rechecking ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />}
                  Kiểm tra lại
                </button>
                <button
                  type="button"
                  onClick={handleCopyClick}
                  disabled={!draftText}
                  className="flex items-center gap-1.5 text-xs font-medium text-stone-600 hover:bg-stone-100 px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-40"
                >
                  {copied ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
                  {copied ? "Đã sao chép" : "Sao chép"}
                </button>
              </div>
            </div>
            <label htmlFor="rm-draft" className="sr-only">
              Nội dung bản viết — sửa được trực tiếp
            </label>
            <textarea
              id="rm-draft"
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              disabled={!editable}
              rows={10}
              className="w-full rounded-lg border border-stone-300 px-3 py-2.5 text-sm leading-relaxed whitespace-pre-wrap disabled:opacity-70 disabled:bg-stone-50 focus:outline-none focus:ring-2 focus:ring-storm-300"
            />
            {recheckError && (
              <div role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {recheckError}
              </div>
            )}
            <p className="text-[11px] text-stone-400">Sửa tay trực tiếp rồi bấm "Kiểm tra lại" để cập nhật kết quả kiểm tra ở trên.</p>
          </div>

          <form onSubmit={handleReviseSubmit} className="bg-white rounded-xl border border-stone-200 p-4 flex flex-col gap-2.5">
            <label htmlFor="rm-revise-note" className="text-sm font-semibold text-stone-700">
              Nhờ viết lại
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                id="rm-revise-note"
                type="text"
                value={reviseNote}
                onChange={(e) => setReviseNote(e.target.value)}
                disabled={revising || watching}
                placeholder='Ví dụ: "ngắn hơn", "đổi hook", "giọng vui hơn"...'
                className="flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={revising || watching || !reviseNote.trim()}
                className="flex items-center justify-center gap-1.5 text-sm font-medium text-white bg-storm-600 hover:bg-storm-700 px-4 py-2 rounded-lg transition-colors disabled:opacity-60 shrink-0"
              >
                {revising ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Send className="w-4 h-4" aria-hidden="true" />}
                Nhờ viết lại
              </button>
            </div>
            {reviseError && (
              <div role="alert" className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {reviseError}
              </div>
            )}
          </form>

          {revisions.length > 0 && (
            <div className="bg-white rounded-xl border border-stone-200 p-4">
              <button
                onClick={() => setRevisionsOpen((o) => !o)}
                aria-expanded={revisionsOpen}
                className="flex items-center justify-between w-full text-sm font-semibold text-stone-700"
              >
                <span>Lịch sử chỉnh sửa ({revisions.length})</span>
                {revisionsOpen ? <ChevronUp className="w-4 h-4" aria-hidden="true" /> : <ChevronDown className="w-4 h-4" aria-hidden="true" />}
              </button>
              {revisionsOpen && (
                <ul className="mt-2.5 flex flex-col gap-2">
                  {[...revisions].reverse().map((rev, i) => (
                    <li key={i} className="text-xs text-stone-500 border-t border-stone-100 pt-2 first:border-t-0 first:pt-0">
                      <span className="font-medium text-stone-600">{formatDate(rev.at)}:</span> đã yêu cầu "{rev.note}"
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        isOpen={confirmCopyOpen}
        title="Bản này còn lỗi chưa sửa"
        message="Bản này còn lỗi chưa sửa. Vẫn sao chép?"
        confirmText="Vẫn sao chép"
        onConfirm={() => {
          setConfirmCopyOpen(false);
          doCopy();
        }}
        onCancel={() => setConfirmCopyOpen(false)}
      />
    </div>
  );
}
