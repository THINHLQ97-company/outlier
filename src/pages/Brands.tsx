import { useEffect, useRef, useState } from "react";
import {
  Plus,
  X,
  Loader2,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Link2,
  FileText,
  Upload,
  AlertTriangle,
  Sparkles,
  Check,
  Fingerprint,
} from "lucide-react";
import {
  listBrands,
  getBrand,
  createBrand,
  updateBrand,
  deleteBrand,
  addBrandSourceUrl,
  addBrandSourceText,
  addBrandSourcePdf,
  deleteBrandSource,
  extractBrandProfile,
  fileToDataUrl,
  type ExtractResult,
} from "../services/brands";
import ConfirmDialog from "../components/ConfirmDialog";
import type { BrandRow, BrandDetail, BrandSource, BrandField, BrandRejectedField } from "../types";
import BrandFanpages from "../components/BrandFanpages";

// Trang "Thương hiệu" — hồ sơ brand bóc từ tài liệu thật, MỖI FIELD KÈM TRÍCH
// DẪN NGUỒN. Linh hồn màn này: field nào không kiểm chứng được thì để trống,
// không bịa — UI phải cho thấy rõ nguồn của từng thông tin (server/routes/
// brands.routes.ts + docs/PRD.md §2).
type FieldKey = "sells" | "audience" | "toneOfVoice" | "addressing" | "bannedTerms" | "allowedClaims";
type FieldKind = "text" | "list";

const FIELD_DEFS: { key: FieldKey; label: string; kind: FieldKind; placeholder: string }[] = [
  { key: "sells", label: "Bán gì / dịch vụ gì", kind: "list", placeholder: "Mỗi dòng một sản phẩm hoặc dịch vụ, ví dụ:\nHosting WordPress\nEmail doanh nghiệp" },
  { key: "audience", label: "Khách hàng là ai", kind: "text", placeholder: "Ví dụ: chủ shop online mới bắt đầu, chưa rành kỹ thuật" },
  { key: "toneOfVoice", label: "Giọng điệu khi nói chuyện", kind: "text", placeholder: "Ví dụ: thân thiện, hài hước, tránh thuật ngữ kỹ thuật" },
  { key: "addressing", label: "Cách xưng hô", kind: "text", placeholder: 'Ví dụ: xưng "Mắt Bão", gọi khách là "bạn"' },
  { key: "bannedTerms", label: "Từ ngữ không nên dùng", kind: "list", placeholder: "Mỗi dòng một từ hoặc cụm từ cần tránh" },
  { key: "allowedClaims", label: "Công dụng được phép nói", kind: "list", placeholder: "Mỗi dòng một công dụng đã kiểm chứng" },
];

const SOURCE_KIND_LABEL: Record<string, string> = {
  website: "Trang web",
  fanpage: "Fanpage",
  pdf: "PDF",
  text: "Văn bản dán tay",
};

const INGEST_META: Record<BrandRow["ingestStatus"], { label: string; cls: string }> = {
  empty: { label: "Chưa bóc", cls: "" },
  running: { label: "Đang bóc...", cls: "ds-badge-warning" },
  ready: { label: "Đã bóc", cls: "ds-badge-success" },
  error: { label: "Lỗi khi bóc", cls: "ds-badge-danger" },
};

export default function Brands() {
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<BrandDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BrandRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function reloadList() {
    setLoading(true);
    setListError(null);
    try {
      setBrands(await listBrands());
    } catch (e: any) {
      setListError(e?.message || "Lỗi tải danh sách thương hiệu.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reloadList();
  }, []);

  async function reloadDetail(id: string) {
    setDetailLoading(true);
    setDetailError(null);
    try {
      setDetail(await getBrand(id));
    } catch (e: any) {
      setDetailError(e?.message || "Không tải được thương hiệu.");
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    if (selectedId) reloadDetail(selectedId);
    else setDetail(null);
  }, [selectedId]);

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteBrand(deleteTarget.id);
      setBrands((prev) => prev.filter((b) => b.id !== deleteTarget.id));
      if (selectedId === deleteTarget.id) setSelectedId(null);
      setDeleteTarget(null);
    } catch (e: any) {
      setListError(e?.message || "Xoá thương hiệu thất bại.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold text-stone-800 font-display">Thương hiệu</h1>
          <p className="text-sm text-stone-500">
            Hồ sơ thương hiệu bóc từ tài liệu thật — mỗi thông tin đều đi kèm nguồn trích. Không tìm thấy trong tài liệu thì để
            trống, hệ thống không tự bịa.
          </p>
        </div>
        <button
          onClick={() => setShowNewForm(true)}
          className="ds-btn ds-btn-primary shrink-0"
        >
          <Plus className="w-4 h-4" aria-hidden="true" /> Thêm thương hiệu mới
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
          ) : brands.length === 0 ? (
            <div className="ds-card">
              <div className="ds-empty">
                <div className="ds-empty-icon">
                  <Fingerprint className="w-8 h-8" aria-hidden="true" />
                </div>
                <p className="ds-empty-title">Chưa có thương hiệu nào</p>
                <p className="ds-empty-desc">Thêm thương hiệu để bắt đầu nạp tài liệu và bóc hồ sơ có trích dẫn nguồn.</p>
                <button onClick={() => setShowNewForm(true)} className="ds-btn ds-btn-primary ds-btn-sm mt-1">
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Thêm thương hiệu mới
                </button>
              </div>
            </div>
          ) : (
            brands.map((b) => (
              <button
                key={b.id}
                onClick={() => setSelectedId(b.id)}
                className={`text-left rounded-xl border px-3 py-2.5 transition-colors ${
                  selectedId === b.id ? "border-storm-400 bg-storm-50" : "border-stone-200 bg-white hover:border-stone-300"
                }`}
              >
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-sm font-semibold text-stone-800 truncate">{b.name}</span>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap mt-1">
                  <span className={`ds-badge ${INGEST_META[b.ingestStatus].cls}`}>{INGEST_META[b.ingestStatus].label}</span>
                  <span className="text-[10px] text-stone-400">{b.isShared ? "Chia sẻ nhóm" : "Chỉ mình tôi"}</span>
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
                  <Fingerprint className="w-8 h-8" aria-hidden="true" />
                </div>
                <p className="ds-empty-title">Chưa chọn thương hiệu</p>
                <p className="ds-empty-desc">Chọn một thương hiệu bên trái để xem hồ sơ, hoặc thêm thương hiệu mới.</p>
              </div>
            </div>
          ) : detailLoading ? (
            <div className="ds-card">
              <div className="flex items-center justify-center py-20 text-stone-400 gap-2">
                <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> Đang tải...
              </div>
            </div>
          ) : detailError ? (
            <div role="alert" className="ds-alert ds-alert-danger">{detailError}</div>
          ) : detail ? (
            <BrandDetailPanel
              key={detail.id}
              brand={detail}
              onPatched={(row) => {
                setDetail((prev) => (prev ? { ...prev, ...row } : prev));
                setBrands((prev) => prev.map((b) => (b.id === row.id ? { ...b, ...row } : b)));
              }}
              onSourcesChanged={() => reloadDetail(detail.id)}
              onExtracted={(row) => {
                setDetail((prev) => (prev ? { ...prev, ...row } : prev));
                setBrands((prev) => prev.map((b) => (b.id === row.id ? { ...b, ...row } : b)));
              }}
              onRequestDelete={() => setDeleteTarget(detail)}
            />
          ) : null}
        </div>
      </div>

      {showNewForm && (
        <NewBrandForm
          onClose={() => setShowNewForm(false)}
          onCreated={(row) => {
            setBrands((prev) => [row, ...prev]);
            setSelectedId(row.id);
            setShowNewForm(false);
          }}
        />
      )}

      <ConfirmDialog
        isOpen={!!deleteTarget}
        title="Xoá thương hiệu?"
        message={`Xoá "${deleteTarget?.name}" cùng toàn bộ tài liệu nguồn đã nạp? Không thể hoàn tác.${deleting ? " Đang xoá..." : ""}`}
        confirmText="Xoá"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function NewBrandForm({ onClose, onCreated }: { onClose: () => void; onCreated: (row: BrandRow) => void }) {
  const [name, setName] = useState("");
  const [isShared, setIsShared] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const row = await createBrand({ name: name.trim(), isShared });
      onCreated(row);
    } catch (e: any) {
      setError(e?.message || "Tạo thương hiệu thất bại.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ds-modal-overlay open" style={{ zIndex: 100 }}>
      <div className="ds-modal max-h-[90vh] overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="new-brand-title">
        <div className="ds-modal-header">
          <h3 id="new-brand-title" className="ds-modal-title font-display">
            Thêm thương hiệu mới
          </h3>
          <button onClick={onClose} className="ds-modal-close" aria-label="Đóng">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="ds-modal-body flex flex-col gap-3">
          <div>
            <label className="ds-label" htmlFor="br-name">
              Tên thương hiệu
            </label>
            <input id="br-name" required value={name} onChange={(e) => setName(e.target.value)} className="ds-input" />
          </div>
          <label className="flex items-center gap-1.5 text-sm text-stone-600">
            <input type="checkbox" checked={isShared} onChange={(e) => setIsShared(e.target.checked)} className="accent-storm-600" />
            Chia sẻ cả nhóm
          </label>
          {error && <div className="ds-alert ds-alert-danger">{error}</div>}
          <button type="submit" disabled={saving} className="ds-btn ds-btn-primary justify-center mt-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />} Tạo thương hiệu
          </button>
        </form>
      </div>
    </div>
  );
}

function BrandDetailPanel({
  brand,
  onPatched,
  onSourcesChanged,
  onExtracted,
  onRequestDelete,
}: {
  brand: BrandDetail;
  onPatched: (row: BrandRow) => void;
  onSourcesChanged: () => void;
  onExtracted: (row: BrandRow) => void;
  onRequestDelete: () => void;
}) {
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(brand.name);
  const [savingName, setSavingName] = useState(false);
  const [headerError, setHeaderError] = useState<string | null>(null);
  const [sharedBusy, setSharedBusy] = useState(false);

  async function handleSaveName(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = nameDraft.trim();
    if (!trimmed) return;
    setSavingName(true);
    setHeaderError(null);
    try {
      const row = await updateBrand(brand.id, { name: trimmed });
      onPatched(row);
      setEditingName(false);
    } catch (e: any) {
      setHeaderError(e?.message || "Lưu tên thất bại.");
    } finally {
      setSavingName(false);
    }
  }

  async function toggleShared() {
    setSharedBusy(true);
    setHeaderError(null);
    try {
      const row = await updateBrand(brand.id, { isShared: !brand.isShared });
      onPatched(row);
    } catch (e: any) {
      setHeaderError(e?.message || "Cập nhật thất bại.");
    } finally {
      setSharedBusy(false);
    }
  }

  async function saveField(key: FieldKey, value: string | string[] | null) {
    const row = await updateBrand(brand.id, { [key]: value } as any);
    onPatched(row);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="ds-card">
        <div className="ds-card-body flex items-start justify-between gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            {editingName ? (
              <form onSubmit={handleSaveName} className="flex items-center gap-1.5">
                <input
                  autoFocus
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  className="ds-input text-lg font-bold text-stone-800 font-display w-auto"
                  aria-label="Tên thương hiệu"
                />
                <button type="submit" disabled={savingName} className="p-1.5 text-storm-600 hover:bg-storm-50 rounded-lg" aria-label="Lưu tên">
                  {savingName ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Check className="w-4 h-4" aria-hidden="true" />}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingName(false)}
                  className="p-1.5 text-stone-400 hover:bg-stone-100 rounded-lg"
                  aria-label="Huỷ sửa tên"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </form>
            ) : (
              <button
                onClick={() => {
                  setNameDraft(brand.name);
                  setEditingName(true);
                }}
                className="group flex items-center gap-1.5 text-left"
                title="Sửa tên thương hiệu"
              >
                <h2 className="text-lg font-bold text-stone-800 font-display truncate">{brand.name}</h2>
                <Pencil className="w-3.5 h-3.5 text-stone-300 group-hover:text-stone-500 shrink-0" aria-hidden="true" />
              </button>
            )}
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              <span className={`ds-badge ${INGEST_META[brand.ingestStatus].cls}`}>{INGEST_META[brand.ingestStatus].label}</span>
              <button
                onClick={toggleShared}
                disabled={sharedBusy}
                className="ds-badge hover:bg-stone-100 transition-colors disabled:opacity-60 cursor-pointer"
                title="Bấm để đổi phạm vi chia sẻ"
              >
                {sharedBusy ? "Đang đổi..." : brand.isShared ? "Chia sẻ nhóm" : "Chỉ mình tôi"}
              </button>
            </div>
          </div>
          <button
            onClick={onRequestDelete}
            className="flex items-center gap-1 text-xs font-medium text-red-600 hover:bg-red-50 px-2.5 py-1.5 rounded-lg transition-colors shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" /> Xoá thương hiệu
          </button>
        </div>
        {headerError && <div className="ds-alert ds-alert-danger mx-4 mb-4">{headerError}</div>}
      </div>

      <BrandFanpages
        brandId={brand.id}
        fanpages={brand.fanpages || []}
        canEdit
        onChanged={onSourcesChanged}
      />

      <SourcesSection brandId={brand.id} sources={brand.sources} onChanged={onSourcesChanged} />

      <ExtractBar brand={brand} onExtracted={onExtracted} />

      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-stone-700">Hồ sơ thương hiệu</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {FIELD_DEFS.map((def) => (
            <FieldCard key={def.key} def={def} field={brand[def.key] as BrandField<any> | null} sources={brand.sources} onSave={(v) => saveField(def.key, v)} />
          ))}
        </div>
      </div>
    </div>
  );
}

function SourcesSection({
  brandId,
  sources,
  onChanged,
}: {
  brandId: string;
  sources: BrandSource[];
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<"link" | "text" | null>(null);
  const [urlVal, setUrlVal] = useState("");
  const [textVal, setTextVal] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BrandSource | null>(null);
  const [deletingSource, setDeletingSource] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function submitUrl(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await addBrandSourceUrl(brandId, urlVal.trim());
      setUrlVal("");
      setMode(null);
      onChanged();
    } catch (e: any) {
      setError(e?.message || "Thêm tài liệu thất bại.");
    } finally {
      setSaving(false);
    }
  }

  async function submitText(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await addBrandSourceText(brandId, textVal);
      setTextVal("");
      setMode(null);
      onChanged();
    } catch (e: any) {
      setError(e?.message || "Thêm tài liệu thất bại.");
    } finally {
      setSaving(false);
    }
  }

  async function handleFile(file: File) {
    setSaving(true);
    setError(null);
    try {
      const dataUrl = await fileToDataUrl(file);
      await addBrandSourcePdf(brandId, dataUrl, file.name);
      onChanged();
    } catch (e: any) {
      setError(e?.message || "Tải PDF thất bại.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteSource() {
    if (!deleteTarget) return;
    setDeletingSource(true);
    try {
      await deleteBrandSource(brandId, deleteTarget.id);
      setDeleteTarget(null);
      onChanged();
    } catch (e: any) {
      setError(e?.message || "Xoá tài liệu thất bại.");
    } finally {
      setDeletingSource(false);
    }
  }

  return (
    <div className="ds-card">
      <div className="ds-card-body flex flex-col gap-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-semibold text-stone-700">Tài liệu nguồn</h3>
          <p className="text-xs text-stone-400 mt-0.5">Trang web, fanpage, PDF hoặc văn bản dán tay — dùng để bóc hồ sơ bên dưới.</p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <button
            onClick={() => setMode(mode === "link" ? null : "link")}
            className="flex items-center gap-1 text-xs font-medium text-stone-600 hover:bg-stone-100 px-2 py-1.5 rounded-lg transition-colors"
          >
            <Link2 className="w-3.5 h-3.5" aria-hidden="true" /> Thêm link
          </button>
          <button
            onClick={() => setMode(mode === "text" ? null : "text")}
            className="flex items-center gap-1 text-xs font-medium text-stone-600 hover:bg-stone-100 px-2 py-1.5 rounded-lg transition-colors"
          >
            <FileText className="w-3.5 h-3.5" aria-hidden="true" /> Dán văn bản
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={saving}
            className="flex items-center gap-1 text-xs font-medium text-stone-600 hover:bg-stone-100 px-2 py-1.5 rounded-lg transition-colors disabled:opacity-50"
          >
            <Upload className="w-3.5 h-3.5" aria-hidden="true" /> Tải PDF
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            aria-label="Tải tài liệu PDF"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      {mode === "link" && (
        <form onSubmit={submitUrl} className="flex items-center gap-2 flex-wrap">
          <label className="sr-only" htmlFor="br-src-url">
            Link tài liệu
          </label>
          <input
            id="br-src-url"
            type="url"
            required
            placeholder="https://..."
            value={urlVal}
            onChange={(e) => setUrlVal(e.target.value)}
            className="ds-input flex-1 min-w-[200px]"
          />
          <button type="submit" disabled={saving} className="ds-btn ds-btn-primary">
            {saving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />} Thêm
          </button>
        </form>
      )}
      {mode === "text" && (
        <form onSubmit={submitText} className="flex flex-col gap-2">
          <label className="sr-only" htmlFor="br-src-text">
            Nội dung dán vào
          </label>
          <textarea
            id="br-src-text"
            required
            rows={4}
            placeholder="Dán nội dung giới thiệu, mô tả sản phẩm, quy định thương hiệu..."
            value={textVal}
            onChange={(e) => setTextVal(e.target.value)}
            className="ds-textarea"
          />
          <button type="submit" disabled={saving} className="ds-btn ds-btn-primary self-start">
            {saving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />} Thêm
          </button>
        </form>
      )}
      {error && <div className="ds-alert ds-alert-danger">{error}</div>}
      {saving && !mode && (
        <div className="flex items-center gap-1.5 text-xs text-stone-400">
          <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Đang tải PDF lên...
        </div>
      )}

      {sources.length === 0 ? (
        <div className="ds-empty py-6">
          <p className="ds-empty-desc">Chưa có tài liệu nào — thêm ít nhất 1 tài liệu để bóc hồ sơ.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {sources.map((s) => (
            <li key={s.id} className="flex items-center gap-2 text-xs bg-stone-50 border border-stone-100 rounded-lg px-2.5 py-1.5">
              <span className="font-medium px-1.5 py-0.5 rounded bg-stone-200 text-stone-600 shrink-0">
                {SOURCE_KIND_LABEL[s.kind] || s.kind}
              </span>
              <span className="flex-1 min-w-0 truncate text-stone-600" title={s.title || s.sourceUrl || undefined}>
                {s.title || s.sourceUrl || "(không có tiêu đề)"}
              </span>
              <span className="text-stone-400 shrink-0">{s.charCount.toLocaleString("vi-VN")} ký tự</span>
              {s.sourceUrl && (
                <a
                  href={s.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-storm-600 hover:underline shrink-0"
                  aria-label="Mở nguồn trong tab mới"
                >
                  <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                </a>
              )}
              <button
                onClick={() => setDeleteTarget(s)}
                className="text-stone-400 hover:text-red-600 shrink-0"
                aria-label={`Xoá tài liệu ${s.title || s.sourceUrl || ""}`}
                title="Xoá tài liệu"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
              {s.status === "error" && s.errorMessage && (
                <span className="text-red-600 shrink-0" title={s.errorMessage}>
                  <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      </div>

      <ConfirmDialog
        isOpen={!!deleteTarget}
        title="Xoá tài liệu?"
        message={`Xoá tài liệu "${deleteTarget?.title || deleteTarget?.sourceUrl || ""}" khỏi thương hiệu này? Những thông tin đã bóc từ tài liệu này vẫn giữ nguyên trong hồ sơ trừ khi bạn bóc lại.${deletingSource ? " Đang xoá..." : ""}`}
        confirmText="Xoá"
        onConfirm={handleDeleteSource}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function ExtractBar({ brand, onExtracted }: { brand: BrandDetail; onExtracted: (row: BrandRow) => void }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rejected, setRejected] = useState<BrandRejectedField[]>([]);

  const running = brand.ingestStatus === "running" || loading;
  const noSources = brand.sources.length === 0;

  async function handleExtract() {
    setLoading(true);
    setError(null);
    setRejected([]);
    try {
      const result: ExtractResult = await extractBrandProfile(brand.id);
      onExtracted(result);
      setRejected(result.rejected || []);
    } catch (e: any) {
      setError(e?.message || "Bóc hồ sơ thất bại.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={handleExtract}
          disabled={running || noSources}
          title={noSources ? "Thêm ít nhất 1 tài liệu nguồn trước" : undefined}
          className="ds-btn ds-btn-primary ds-btn-lg"
        >
          {running ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Sparkles className="w-4 h-4" aria-hidden="true" />}
          {running ? "Đang bóc hồ sơ..." : "Bóc hồ sơ từ tài liệu"}
        </button>
        <span className="text-xs text-stone-400">
          Chỉ ghi vào hồ sơ những gì trích được nguyên văn từ tài liệu; các mục đã sửa tay sẽ được giữ nguyên.
        </span>
      </div>
      {error && <div className="ds-alert ds-alert-danger">{error}</div>}
      {rejected.length > 0 && (
        <div className="ds-alert ds-alert-warning flex-col !items-stretch gap-2">
          <p className="flex items-center gap-1.5 font-medium">
            <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
            Hệ thống đã chặn {rejected.length} thông tin không kiểm chứng được — không ghi vào hồ sơ
          </p>
          <ul className="flex flex-col gap-1.5">
            {rejected.map((r, i) => {
              const def = FIELD_DEFS.find((f) => f.key === r.field);
              return (
                <li key={i} className="text-xs bg-white/60 border border-amber-100 rounded-lg px-2.5 py-1.5">
                  <span className="font-semibold">{def?.label || r.field}:</span> {r.reason}
                  {r.claimedQuote && <span className="block italic text-amber-700 mt-0.5">AI đã khai: "{r.claimedQuote}"</span>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function FieldCard({
  def,
  field,
  sources,
  onSave,
}: {
  def: (typeof FIELD_DEFS)[number];
  field: BrandField<any> | null;
  sources: BrandSource[];
  onSave: (value: string | string[] | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);

  const hasValue = !!field && (Array.isArray(field.value) ? field.value.length > 0 : !!field.value);

  function startEdit() {
    setDraft(def.kind === "list" ? (Array.isArray(field?.value) ? field!.value.join("\n") : "") : typeof field?.value === "string" ? field!.value : "");
    setError(null);
    setEditing(true);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      if (def.kind === "list") {
        const arr = draft
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
        await onSave(arr.length ? arr : null);
      } else {
        const v = draft.trim();
        await onSave(v || null);
      }
      setEditing(false);
    } catch (e: any) {
      setError(e?.message || "Lưu thất bại.");
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    setSaving(true);
    setError(null);
    try {
      await onSave(null);
      setEditing(false);
    } catch (e: any) {
      setError(e?.message || "Xoá dữ liệu thất bại.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className={`ds-card ${hasValue ? "" : "border-dashed"}`}
    >
      <div className="ds-card-body flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <h3 className="text-sm font-semibold text-stone-800">{def.label}</h3>
          {field?.source === "manual" && (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">Nhập tay</span>
          )}
        </div>
        {!editing && (
          <button
            onClick={startEdit}
            className="p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-600 rounded-lg shrink-0"
            aria-label={`Sửa ${def.label}`}
            title="Sửa tay"
          >
            <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      {editing ? (
        <div className="flex flex-col gap-2">
          <label className="sr-only" htmlFor={`brf-${def.key}`}>
            {def.label}
          </label>
          <textarea
            id={`brf-${def.key}`}
            rows={def.kind === "list" ? 4 : 2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={def.placeholder}
            className="ds-textarea"
          />
          {error && <div className="ds-field-error">{error}</div>}
          <div className="flex items-center gap-2">
            <button onClick={handleSave} disabled={saving} className="ds-btn ds-btn-primary ds-btn-sm">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />} Lưu
            </button>
            <button
              onClick={() => setEditing(false)}
              disabled={saving}
              className="text-xs font-medium text-stone-500 hover:bg-stone-100 px-2.5 py-1.5 rounded-lg disabled:opacity-60"
            >
              Huỷ
            </button>
            {hasValue && (
              <button onClick={handleClear} disabled={saving} className="text-xs font-medium text-red-600 hover:bg-red-50 px-2.5 py-1.5 rounded-lg ml-auto disabled:opacity-60">
                Xoá dữ liệu
              </button>
            )}
          </div>
        </div>
      ) : hasValue ? (
        <>
          {def.kind === "list" ? (
            <div className="flex flex-wrap gap-1.5">
              {(field!.value as string[]).map((v, i) => (
                <span key={i} className="ds-badge-primary ds-badge">
                  {v}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-stone-700 leading-relaxed">{field!.value as string}</p>
          )}
          {field!.evidence.length > 0 && (
            <div>
              <button
                onClick={() => setEvidenceOpen((v) => !v)}
                className="text-[11px] text-stone-400 hover:text-stone-600 underline underline-offset-2 flex items-center gap-1"
              >
                {evidenceOpen ? <ChevronUp className="w-3 h-3" aria-hidden="true" /> : <ChevronDown className="w-3 h-3" aria-hidden="true" />}
                Nguồn trích ({field!.evidence.length})
              </button>
              {evidenceOpen && (
                <ul className="flex flex-col gap-1.5 mt-1.5">
                  {field!.evidence.map((ev, i) => {
                    const url = ev.sourceUrl || sources.find((s) => s.id === ev.sourceId)?.sourceUrl;
                    return (
                      <li key={i} className="text-xs text-stone-500 bg-stone-50 border border-stone-100 rounded-lg px-2.5 py-1.5">
                        <span className="italic">"{ev.quote}"</span>
                        {url && (
                          <a href={url} target="_blank" rel="noreferrer" className="ml-1.5 inline-flex items-center gap-0.5 text-storm-600 hover:underline">
                            Nguồn <ExternalLink className="w-3 h-3" aria-hidden="true" />
                          </a>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="ds-empty py-4">
          <p className="ds-empty-desc">Chưa có dữ liệu — bấm "Bóc hồ sơ từ tài liệu" hoặc bấm sửa để nhập tay.</p>
        </div>
      )}
      </div>
    </div>
  );
}
