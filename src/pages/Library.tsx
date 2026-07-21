import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Loader2,
  X,
  Download,
  BookmarkPlus,
  Plus,
  Pencil,
  Trash2,
  Upload,
  ImageOff,
  ExternalLink,
} from "lucide-react";
import { getGallery, savePostAsAsset } from "../services/posts";
import { listAssets, createAsset, updateAsset, deleteAsset } from "../services/assets";
import { imageDisplayUrl } from "../services/http";
import { fileToDataUrl } from "../services/characters";
import { AXES } from "../../shared/engine-data";
import ConfirmDialog from "../components/ConfirmDialog";
import type { GalleryPost, AssetRow, AssetKind, PostStatus, AxisKey } from "../types";

const TABS = [
  { key: "gallery", label: "Ảnh đã tạo" },
  { key: "assets", label: "Template & tham chiếu" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const STATUS_LABEL: Record<PostStatus, string> = {
  draft: "Nháp",
  cho_duyet: "Chờ duyệt",
  sua_thoai: "Sửa thoại",
  rot: "Rớt",
  san_sang_dang: "Sẵn sàng đăng",
  da_dang: "Đã đăng",
};
const STATUS_BADGE: Record<PostStatus, string> = {
  draft: "bg-stone-100 text-stone-600",
  cho_duyet: "bg-amber-50 text-amber-700",
  sua_thoai: "bg-amber-50 text-amber-700",
  rot: "bg-red-50 text-red-600",
  san_sang_dang: "bg-storm-50 text-storm-700",
  da_dang: "bg-green-50 text-green-700",
};
const ORIGIN_LABEL: Record<string, string> = { pipeline: "Pipeline", studio: "Studio" };

// Thư viện — 2 tab: (1) "Ảnh đã tạo" (gallery post đã có ảnh) và (2) "Template
// & tham chiếu" (assets, quản lý CRUD theo quyền sở hữu).
export default function Library() {
  const [tab, setTab] = useState<TabKey>("gallery");
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-bold text-stone-800 font-display">Thư viện</h1>
        <p className="text-sm text-stone-500">Ảnh đã tạo (pipeline + Studio) và kho template meme / ảnh tham chiếu.</p>
      </div>
      <div className="flex gap-1 border-b border-stone-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key ? "border-storm-600 text-storm-700" : "border-transparent text-stone-500 hover:text-stone-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "gallery" ? <GalleryTab /> : <AssetsTab />}
    </div>
  );
}

// ===== Tab 1 — Ảnh đã tạo (gallery) =====

const SCOPE_OPTIONS: { value: "all" | "mine" | "shared"; label: string }[] = [
  { value: "all", label: "Tất cả" },
  { value: "mine", label: "Của tôi" },
  { value: "shared", label: "Chia sẻ" },
];

function GalleryTab() {
  const [scope, setScope] = useState<"all" | "mine" | "shared">("all");
  const [items, setItems] = useState<GalleryPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<GalleryPost | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getGallery(scope)
      .then(setItems)
      .catch((e) => setError(e?.message || "Lỗi tải thư viện ảnh."))
      .finally(() => setLoading(false));
  }, [scope]);

  function thumbUrl(p: GalleryPost): string | null {
    return imageDisplayUrl(p.finalImageUrl || p.selectedImageUrl || p.imageVariants[0]?.url);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-1.5">
        {SCOPE_OPTIONS.map((o) => (
          <button
            key={o.value}
            onClick={() => setScope(o.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              scope === o.value ? "bg-storm-100 text-storm-800" : "bg-stone-100 text-stone-500 hover:bg-stone-200"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-stone-400 gap-2">
          <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> Đang tải...
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-stone-400 text-sm">Chưa có ảnh nào.</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {items.map((p) => {
            const url = thumbUrl(p);
            return (
              <button
                key={p.id}
                onClick={() => setDetail(p)}
                className="text-left rounded-xl overflow-hidden border border-stone-200 bg-white hover:border-storm-300 transition-colors"
              >
                <div className="aspect-square bg-stone-100 flex items-center justify-center">
                  {url ? (
                    <img src={url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <ImageOff className="w-6 h-6 text-stone-300" aria-hidden="true" />
                  )}
                </div>
                <div className="p-2 flex flex-col gap-1">
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-stone-100 text-stone-600">
                      {ORIGIN_LABEL[p.origin] || p.origin}
                    </span>
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${STATUS_BADGE[p.status]}`}>
                      {STATUS_LABEL[p.status]}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[10px] text-stone-400 truncate">
                      {p.truc ? AXES[p.truc as AxisKey]?.label ?? p.truc : "—"}
                    </span>
                    <span className="text-[10px] text-storm-600 font-medium shrink-0">
                      {p.isMine ? "Của tôi" : "Chung"}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {detail && <GalleryDetailModal post={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function GalleryDetailModal({ post, onClose }: { post: GalleryPost; onClose: () => void }) {
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [assetName, setAssetName] = useState(post.caption?.slice(0, 60) || "Ảnh từ thư viện");
  const [assetKind, setAssetKind] = useState<AssetKind>("reference");
  const [assetShared, setAssetShared] = useState(post.isShared);

  const url = imageDisplayUrl(post.finalImageUrl || post.selectedImageUrl || post.imageVariants[0]?.url);
  const canEdit = post.status === "draft" || post.status === "sua_thoai";

  async function handleSaveAsAsset() {
    setSaving(true);
    setSaveErr(null);
    setSaveMsg(null);
    try {
      await savePostAsAsset(post.id, { name: assetName.trim() || "Ảnh từ thư viện", kind: assetKind, isShared: assetShared });
      setSaveMsg("Đã lưu vào Template & tham chiếu.");
      setShowSaveForm(false);
    } catch (e: any) {
      // Ảnh demo (data-URL/placeholder, không phải file nội bộ) → server trả 400 — hiện lỗi rõ, không crash.
      setSaveErr(e?.message || "Lưu làm tham chiếu thất bại.");
    } finally {
      setSaving(false);
    }
  }

  function handleDownload() {
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `matbao-${post.id}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-stone-100">
          <h3 className="font-semibold text-stone-800 font-display">Chi tiết ảnh</h3>
          <button onClick={onClose} className="p-1.5 text-stone-400 hover:bg-stone-100 rounded-full" aria-label="Đóng">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        <div className="p-5 flex flex-col gap-3">
          <div className="rounded-lg overflow-hidden bg-stone-100 flex items-center justify-center">
            {url ? <img src={url} alt="" className="w-full max-h-96 object-contain" /> : <ImageOff className="w-8 h-8 text-stone-300 m-10" aria-hidden="true" />}
          </div>
          {post.caption && <p className="text-sm text-stone-600 italic">"{post.caption}"</p>}
          <div className="flex items-center gap-1.5 flex-wrap text-xs">
            <span className="px-1.5 py-0.5 rounded bg-stone-100 text-stone-600">{ORIGIN_LABEL[post.origin] || post.origin}</span>
            <span className={`px-1.5 py-0.5 rounded ${STATUS_BADGE[post.status]}`}>{STATUS_LABEL[post.status]}</span>
            <span className="px-1.5 py-0.5 rounded bg-stone-100 text-stone-600">
              {post.truc ? AXES[post.truc as AxisKey]?.label ?? post.truc : "Không gắn trục"}
            </span>
            <span className="px-1.5 py-0.5 rounded bg-storm-50 text-storm-700">{post.isMine ? "Của tôi" : "Chung"}</span>
          </div>

          {saveErr && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{saveErr}</div>}
          {saveMsg && <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">{saveMsg}</div>}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              onClick={handleDownload}
              disabled={!url}
              className="flex items-center gap-1.5 text-sm font-medium text-stone-700 bg-stone-100 hover:bg-stone-200 px-3 py-2 rounded-lg disabled:opacity-50"
            >
              <Download className="w-4 h-4" aria-hidden="true" /> Tải ảnh
            </button>
            <button
              onClick={() => setShowSaveForm((v) => !v)}
              className="flex items-center gap-1.5 text-sm font-medium text-storm-700 bg-storm-50 hover:bg-storm-100 px-3 py-2 rounded-lg"
            >
              <BookmarkPlus className="w-4 h-4" aria-hidden="true" /> Lưu làm tham chiếu
            </button>
            {canEdit && (
              <Link
                to={`/image-studio?postId=${post.id}`}
                className="flex items-center gap-1.5 text-sm font-medium text-stone-700 hover:bg-stone-100 px-3 py-2 rounded-lg"
              >
                <ExternalLink className="w-4 h-4" aria-hidden="true" /> Mở lại để sửa
              </Link>
            )}
          </div>

          {showSaveForm && (
            <div className="flex flex-col gap-2 bg-stone-50 border border-stone-200 rounded-lg p-3">
              <label className="text-xs font-medium text-stone-600" htmlFor="save-asset-name">Tên asset</label>
              <input
                id="save-asset-name"
                value={assetName}
                onChange={(e) => setAssetName(e.target.value)}
                className="w-full rounded-lg border border-stone-300 px-2.5 py-1.5 text-sm"
              />
              <label className="text-xs font-medium text-stone-600" htmlFor="save-asset-kind">Loại</label>
              <select
                id="save-asset-kind"
                value={assetKind}
                onChange={(e) => setAssetKind(e.target.value as AssetKind)}
                className="w-full rounded-lg border border-stone-300 px-2.5 py-1.5 text-sm"
              >
                <option value="reference">Tham chiếu</option>
                <option value="meme_template">Template meme</option>
              </select>
              <label className="flex items-center gap-1.5 text-xs text-stone-500">
                <input type="checkbox" checked={assetShared} onChange={(e) => setAssetShared(e.target.checked)} className="accent-storm-600" />
                Chia sẻ team
              </label>
              <button
                onClick={handleSaveAsAsset}
                disabled={saving}
                className="flex items-center justify-center gap-2 bg-storm-600 hover:bg-storm-700 text-white text-sm font-medium rounded-lg py-2 disabled:opacity-60"
              >
                {saving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />} Xác nhận lưu
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ===== Tab 2 — Template & tham chiếu (assets) =====

const KIND_FILTERS: { value: AssetKind | "all"; label: string }[] = [
  { value: "all", label: "Tất cả" },
  { value: "meme_template", label: "Template meme" },
  { value: "reference", label: "Tham chiếu" },
];
const KIND_BADGE: Record<AssetKind, string> = {
  meme_template: "bg-amber-50 text-amber-700",
  reference: "bg-blue-50 text-blue-700",
};
const KIND_LABEL: Record<AssetKind, string> = {
  meme_template: "Template meme",
  reference: "Tham chiếu",
};

function AssetsTab() {
  const [kindFilter, setKindFilter] = useState<AssetKind | "all">("all");
  const [items, setItems] = useState<AssetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formTarget, setFormTarget] = useState<AssetRow | "new" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AssetRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      setItems(await listAssets(kindFilter === "all" ? undefined : kindFilter));
    } catch (e: any) {
      setError(e?.message || "Lỗi tải kho tham chiếu.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kindFilter]);

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteAsset(deleteTarget.id);
      setItems((prev) => prev.filter((x) => x.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (e: any) {
      setError(e?.message || "Xoá asset thất bại.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-1.5">
          {KIND_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setKindFilter(f.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                kindFilter === f.value ? "bg-storm-100 text-storm-800" : "bg-stone-100 text-stone-500 hover:bg-stone-200"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setFormTarget("new")}
          className="flex items-center gap-1.5 text-sm font-medium text-white bg-storm-600 hover:bg-storm-700 px-3 py-2 rounded-lg"
        >
          <Plus className="w-4 h-4" aria-hidden="true" /> Thêm mới
        </button>
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-stone-400 gap-2">
          <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> Đang tải...
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-stone-400 text-sm">Chưa có asset nào.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map((a) => (
            <div key={a.id} className="flex flex-col gap-2 bg-white p-3 rounded-xl border border-stone-200 shadow-sm">
              <div className="aspect-video rounded-lg overflow-hidden bg-stone-100">
                <img src={imageDisplayUrl(a.imageUrl) || undefined} alt={a.name} className="w-full h-full object-cover" />
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-sm font-semibold text-stone-800 truncate flex-1 min-w-0">{a.name}</span>
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${KIND_BADGE[a.kind]}`}>{KIND_LABEL[a.kind]}</span>
              </div>
              {a.note && <p className="text-xs text-stone-500 line-clamp-2">{a.note}</p>}
              <div className="flex items-center justify-between mt-auto pt-1 border-t border-stone-100">
                <span className="text-[10px] text-storm-600 font-medium">{a.isMine ? "Của tôi" : "Chung"}</span>
                {a.isMine ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setFormTarget(a)}
                      className="flex items-center gap-1 text-xs font-medium text-stone-600 hover:bg-stone-100 px-2 py-1 rounded-lg"
                      title="Sửa asset"
                    >
                      <Pencil className="w-3.5 h-3.5" aria-hidden="true" /> Sửa
                    </button>
                    <button
                      onClick={() => setDeleteTarget(a)}
                      className="flex items-center gap-1 text-xs font-medium text-red-600 hover:bg-red-50 px-2 py-1 rounded-lg"
                      title="Xoá asset"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                ) : (
                  <span className="text-[10px] text-stone-400">Chỉ xem</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {formTarget && (
        <AssetForm
          initial={formTarget === "new" ? null : formTarget}
          onClose={() => setFormTarget(null)}
          onSaved={(row) => {
            setItems((prev) => {
              const exists = prev.some((x) => x.id === row.id);
              return exists ? prev.map((x) => (x.id === row.id ? row : x)) : [row, ...prev];
            });
            setFormTarget(null);
          }}
        />
      )}

      <ConfirmDialog
        isOpen={!!deleteTarget}
        title="Xoá asset?"
        message={`Xoá "${deleteTarget?.name}" khỏi kho tham chiếu? Không thể hoàn tác.`}
        confirmText={deleting ? "Đang xoá..." : "Xoá"}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function AssetForm({
  initial,
  onClose,
  onSaved,
}: {
  initial: AssetRow | null;
  onClose: () => void;
  onSaved: (row: AssetRow) => void;
}) {
  const [kind, setKind] = useState<AssetKind>(initial?.kind || "reference");
  const [name, setName] = useState(initial?.name || "");
  const [note, setNote] = useState(initial?.note || "");
  const [isShared, setIsShared] = useState(initial?.isShared || false);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    try {
      setImageDataUrl(await fileToDataUrl(file));
    } catch (e: any) {
      setError(e?.message || "Đọc file ảnh thất bại.");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Thiếu tên asset.");
      return;
    }
    if (!initial && !imageDataUrl) {
      setError("Thiếu ảnh — bắt buộc khi thêm mới.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const row = initial
        ? await updateAsset(initial.id, {
            name: name.trim(),
            note: note || undefined,
            isShared,
            imageDataUrl: imageDataUrl || undefined,
          })
        : await createAsset({ kind, name: name.trim(), note: note || undefined, isShared, imageDataUrl: imageDataUrl! });
      onSaved(row);
    } catch (e: any) {
      setError(e?.message || "Lưu asset thất bại.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-stone-100">
          <h3 className="font-semibold text-stone-800 font-display">
            {initial ? `Sửa asset — ${initial.name}` : "Thêm asset mới"}
          </h3>
          <button onClick={onClose} className="p-1.5 text-stone-400 hover:bg-stone-100 rounded-full" aria-label="Đóng">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-3">
          {!initial && (
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1" htmlFor="as-kind">Loại</label>
              <select
                id="as-kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as AssetKind)}
                className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
              >
                <option value="reference">Ảnh tham chiếu</option>
                <option value="meme_template">Template meme</option>
              </select>
            </div>
          )}
          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1" htmlFor="as-name">Tên</label>
            <input
              id="as-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1" htmlFor="as-note">Ghi chú (tuỳ chọn)</label>
            <textarea
              id="as-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
            />
          </div>
          <label className="flex items-center gap-1.5 text-sm text-stone-600">
            <input type="checkbox" checked={isShared} onChange={(e) => setIsShared(e.target.checked)} className="accent-storm-600" />
            Chia sẻ team
          </label>
          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1" htmlFor="as-file">
              Ảnh {initial ? "(để trống nếu giữ ảnh cũ)" : "(bắt buộc)"}
            </label>
            <div className="flex items-center gap-2">
              <label
                htmlFor="as-file"
                className="flex items-center gap-1.5 text-xs font-medium text-storm-700 bg-storm-50 hover:bg-storm-100 px-3 py-2 rounded-lg cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" aria-hidden="true" /> Chọn ảnh
              </label>
              <input
                id="as-file"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                }}
              />
              {imageDataUrl ? (
                <img src={imageDataUrl} alt="Xem trước" className="w-12 h-12 rounded-lg object-cover border border-stone-200" />
              ) : initial?.imageUrl ? (
                <img src={imageDisplayUrl(initial.imageUrl) || undefined} alt="Ảnh hiện tại" className="w-12 h-12 rounded-lg object-cover border border-stone-200" />
              ) : (
                <span className="text-xs text-stone-400">Chưa chọn ảnh</span>
              )}
            </div>
          </div>
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
          <button
            type="submit"
            disabled={saving}
            className="mt-2 flex items-center justify-center gap-2 bg-storm-600 hover:bg-storm-700 text-white text-sm font-medium rounded-lg py-2.5 disabled:opacity-60"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />} Lưu asset
          </button>
        </form>
      </div>
    </div>
  );
}
