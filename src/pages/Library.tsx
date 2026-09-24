import { Fragment, useEffect, useRef, useState } from "react";
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
  UserRound,
  Sparkles,
  Wand2,
  ChevronDown,
  ChevronUp,
  Heart,
  Brain,
  RefreshCw,
} from "lucide-react";
import { getGallery, savePostAsAsset, deleteGalleryPost, getPost } from "../services/posts";
import {
  favoriteImage,
  unfavoriteImage,
  getFavoriteIds,
  listRagExamples,
  deleteRagExample,
  getRagProfile,
  rebuildRagProfile,
} from "../services/rag";
import {
  listCharacters,
  createCharacter,
  updateCharacter,
  deleteCharacter,
  generateCharacterReference,
  fileToDataUrl,
  type CharacterInput,
} from "../services/characters";
import { listStyles, createStyle, updateStyle, deleteStyle, generateStyleReference, analyzeStyle } from "../services/styles";
import { imageDisplayUrl } from "../services/http";
import { useAppContext } from "../AppContext";
import { AXES } from "../../shared/engine-data";
import ConfirmDialog from "../components/ConfirmDialog";
import type { GalleryPost, PostStatus, AxisKey, CharacterRow, CharacterKind, StyleRow, AssetKind, RagExample, RagProfile } from "../types";
import { PostsTab, ImagesTab, VideosTab } from "../components/LibraryContentTabs";

// Hai nhóm tab khác hẳn nhau: nhóm đầu là THÀNH PHẨM (đem đi dùng được ngay),
// nhóm sau là NGUYÊN LIỆU (dùng để làm ra thành phẩm). Trộn chung một hàng thì
// người dùng phải tự đoán cái nào là cái nào.
const CONTENT_TABS = [
  { key: "posts", label: "Bài viết" },
  { key: "images", label: "Hình ảnh" },
  { key: "videos", label: "Video" },
] as const;

const RESOURCE_TABS = [
  { key: "gallery", label: "Ảnh meme cũ" },
  { key: "characters", label: "Nhân vật" },
  { key: "styles", label: "Phong cách" },
  { key: "rag", label: "RAG (ảnh đã thích)" },
] as const;

const TABS = [...CONTENT_TABS, ...RESOURCE_TABS];
type TabKey = (typeof TABS)[number]["key"];

// Thư viện — 4 tab: Ảnh (bài đã tạo, pipeline + Studio), Nhân vật (dàn nhân vật
// cố định), Phong cách (thư viện phong cách vẽ), RAG (kho ảnh đã thích + hồ sơ gu).
export default function Library() {
  const [tab, setTab] = useState<TabKey>("posts");
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-bold text-stone-800 font-display">Thư viện</h1>
        <p className="text-sm text-stone-500">
          Thành phẩm đã làm ra (bài viết, hình ảnh, video) và nguyên liệu để làm ra chúng.
        </p>
      </div>
      <div className="flex gap-1 border-b border-stone-200 overflow-x-auto">
        {TABS.map((t, i) => (
          <Fragment key={t.key}>
            {i === CONTENT_TABS.length && (
              <span className="w-px bg-stone-200 my-2 mx-2 shrink-0" aria-hidden="true" />
            )}
            <button
              type="button"
              onClick={() => setTab(t.key)}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
                tab === t.key ? "border-storm-600 text-storm-700" : "border-transparent text-stone-500 hover:text-stone-700"
              }`}
            >
              {t.label}
            </button>
          </Fragment>
        ))}
      </div>
      {tab === "posts" && <PostsTab />}
      {tab === "images" && <ImagesTab />}
      {tab === "videos" && <VideosTab />}
      {tab === "gallery" && <GalleryTab />}
      {tab === "characters" && <CharactersTab />}
      {tab === "styles" && <StylesTab />}
      {tab === "rag" && <RagTab />}
    </div>
  );
}

// ===== Tab "Ảnh" — bài đã tạo (gallery) =====

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
const ORIGIN_LABEL: Record<string, string> = { pipeline: "Pipeline", studio: "Sáng tạo" };

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
  const [favIds, setFavIds] = useState<Set<string>>(new Set());
  const [favBusyId, setFavBusyId] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getGallery(scope)
      .then(setItems)
      .catch((e) => setError(e?.message || "Lỗi tải thư viện ảnh."))
      .finally(() => setLoading(false));
  }, [scope]);

  useEffect(() => {
    getFavoriteIds()
      .then((ids) => setFavIds(new Set(ids)))
      .catch(() => {
        /* best-effort */
      });
  }, []);

  async function toggleFav(p: GalleryPost) {
    setFavBusyId(p.id);
    setError(null);
    try {
      if (favIds.has(p.id)) {
        await unfavoriteImage(p.id);
        setFavIds((prev) => {
          const next = new Set(prev);
          next.delete(p.id);
          return next;
        });
      } else {
        await favoriteImage(p.id, p.isShared);
        setFavIds((prev) => new Set(prev).add(p.id));
      }
    } catch (e: any) {
      setError(e?.message || "Thao tác yêu thích thất bại.");
    } finally {
      setFavBusyId(null);
    }
  }

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

      {error && <div role="alert" className="ds-alert ds-alert-danger">{error}</div>}

      {loading ? (
        <div className="ds-card">
          <div className="flex items-center justify-center py-16 text-stone-400 gap-2">
            <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> Đang tải...
          </div>
        </div>
      ) : items.length === 0 ? (
        <div className="ds-card">
          <div className="ds-empty">
            <div className="ds-empty-icon">
              <ImageOff className="w-8 h-8" aria-hidden="true" />
            </div>
            <p className="ds-empty-title">Chưa có ảnh nào</p>
            <p className="ds-empty-desc">Tạo ảnh mới ở trang Sáng tạo rồi lưu vào thư viện.</p>
            <Link to="/studio" className="ds-btn ds-btn-primary ds-btn-sm mt-1">
              <Wand2 className="w-3.5 h-3.5" aria-hidden="true" /> Đi tới Sáng tạo
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {items.map((p) => {
            const url = thumbUrl(p);
            const faved = favIds.has(p.id);
            return (
              <div
                key={p.id}
                className="relative text-left rounded-xl overflow-hidden border border-stone-200 bg-white hover:border-storm-300 transition-colors"
              >
                <button onClick={() => setDetail(p)} className="block w-full text-left">
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
                <button
                  onClick={() => toggleFav(p)}
                  disabled={favBusyId === p.id}
                  aria-pressed={faved}
                  title={faved ? "Bỏ thích (gỡ khỏi RAG)" : "Thả tim — lưu vào RAG để học gu"}
                  className={`absolute top-1.5 right-1.5 rounded-full p-1.5 shadow-sm transition-colors ${
                    faved ? "bg-rose-500 text-white" : "bg-white/85 text-stone-500 hover:bg-white hover:text-rose-500"
                  }`}
                >
                  {favBusyId === p.id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Heart className={`w-3.5 h-3.5 ${faved ? "fill-white" : ""}`} aria-hidden="true" />
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {detail && (
        <GalleryDetailModal
          post={detail}
          isFavorite={favIds.has(detail.id)}
          onToggleFavorite={() => toggleFav(detail)}
          favBusy={favBusyId === detail.id}
          onClose={() => setDetail(null)}
          onDeleted={(id) => {
            setItems((prev) => prev.filter((p) => p.id !== id));
            setDetail(null);
          }}
        />
      )}
    </div>
  );
}

function GalleryDetailModal({
  post,
  isFavorite,
  onToggleFavorite,
  favBusy,
  onClose,
  onDeleted,
}: {
  post: GalleryPost;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  favBusy: boolean;
  onClose: () => void;
  onDeleted: (id: string) => void;
}) {
  const { isAdmin } = useAppContext();
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [assetName, setAssetName] = useState(post.caption?.slice(0, 60) || "Ảnh từ thư viện");
  const [assetKind, setAssetKind] = useState<AssetKind>("reference");
  const [assetShared, setAssetShared] = useState(post.isShared);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const canDelete = post.isMine || isAdmin;

  // Nạp thêm chi tiết (prompt trước + nhân vật + style) — gallery list không kèm
  // overlayJson để nhẹ, nên fetch full post khi mở chi tiết.
  const [debug, setDebug] = useState<{ prompt: string; characters: string[]; charactersRef?: string[]; style?: string | null; ragUsed?: number } | null>(null);
  const [scene, setScene] = useState<string | null>(null);
  const [charNames, setCharNames] = useState<string[]>([]); // tên nhân vật hiển thị (đa nguồn)
  const [showPrompt, setShowPrompt] = useState(false);
  useEffect(() => {
    Promise.all([getPost(post.id), listCharacters().catch(() => [] as CharacterRow[])])
      .then(([full, allChars]) => {
        const dbg = (full.overlayJson?.promptDebug as any) || null;
        setDebug(dbg);
        setScene(full.promptText || null);
        // Tên nhân vật: ưu tiên promptDebug.characters; rỗng (bài cũ) → map từ
        // studioParams.characterIds sang tên qua thư viện nhân vật.
        let names: string[] = dbg?.characters || [];
        if (!names.length) {
          const ids: string[] = (full.overlayJson?.studioParams?.characterIds as string[]) || [];
          names = ids.map((id) => allChars.find((c) => c.id === id)?.name).filter((n): n is string => !!n);
        }
        setCharNames(names);
      })
      .catch(() => {
        /* best-effort — không có prompt vẫn xem ảnh được */
      });
  }, [post.id]);

  async function handleDelete() {
    setDeleting(true);
    setSaveErr(null);
    try {
      await deleteGalleryPost(post.id);
      onDeleted(post.id);
    } catch (e: any) {
      setSaveErr(e?.message || "Xoá ảnh thất bại.");
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  const url = imageDisplayUrl(post.finalImageUrl || post.selectedImageUrl || post.imageVariants[0]?.url);
  const canEdit = post.status === "draft" || post.status === "sua_thoai";

  async function handleSaveAsAsset() {
    setSaving(true);
    setSaveErr(null);
    setSaveMsg(null);
    try {
      await savePostAsAsset(post.id, { name: assetName.trim() || "Ảnh từ thư viện", kind: assetKind, isShared: assetShared });
      setSaveMsg("Đã lưu làm ảnh tham chiếu — chọn được ở trang Sáng tạo.");
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
    <div className="ds-modal-overlay open" style={{ zIndex: 100 }}>
      <div className="ds-modal max-w-lg max-h-[90vh] overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="gallery-detail-title">
        <div className="ds-modal-header">
          <h3 id="gallery-detail-title" className="ds-modal-title font-display">Chi tiết ảnh</h3>
          <div className="flex items-center gap-1.5">
            <button
              onClick={onToggleFavorite}
              disabled={favBusy}
              aria-pressed={isFavorite}
              title={isFavorite ? "Bỏ thích (gỡ khỏi RAG)" : "Thả tim — lưu prompt & thông số vào RAG"}
              className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border transition-colors ${
                isFavorite ? "bg-rose-50 border-rose-200 text-rose-600" : "bg-white border-stone-200 text-stone-500 hover:border-rose-200 hover:text-rose-500"
              }`}
            >
              {favBusy ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Heart className={`w-3.5 h-3.5 ${isFavorite ? "fill-rose-500 text-rose-500" : ""}`} aria-hidden="true" />
              )}
              {isFavorite ? "Đã thích" : "Thích"}
            </button>
            <button onClick={onClose} className="ds-modal-close" aria-label="Đóng">
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="ds-modal-body flex flex-col gap-3">
          <div className="rounded-lg overflow-hidden bg-stone-100 flex items-center justify-center">
            {url ? <img src={url} alt="" className="w-full max-h-96 object-contain" /> : <ImageOff className="w-8 h-8 text-stone-300 m-10" aria-hidden="true" />}
          </div>
          {post.caption && <p className="text-sm text-stone-600 italic">"{post.caption}"</p>}
          <div className="flex items-center gap-1.5 flex-wrap text-xs">
            <span className="px-1.5 py-0.5 rounded bg-stone-100 text-stone-600">{ORIGIN_LABEL[post.origin] || post.origin}</span>
            <span className={`px-1.5 py-0.5 rounded ${STATUS_BADGE[post.status]}`}>{STATUS_LABEL[post.status]}</span>
            <span className="px-1.5 py-0.5 rounded bg-stone-100 text-stone-600">
              {post.truc ? AXES[post.truc as AxisKey]?.label ?? post.truc : "Chưa gắn chủ đề"}
            </span>
            <span className="px-1.5 py-0.5 rounded bg-storm-50 text-storm-700">{post.isMine ? "Của tôi" : "Chung"}</span>
          </div>

          {/* Prompt trước + nhân vật đã dùng + phong cách đã chọn */}
          {(scene || debug) && (
            <div className="bg-stone-50 border border-stone-200 rounded-lg p-3 flex flex-col gap-2">
              <p className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide">Đã tạo bằng</p>
              {scene && (
                <div>
                  <p className="text-[11px] font-medium text-stone-500 mb-0.5">Mô tả (prompt)</p>
                  <p className="text-xs text-stone-700 leading-snug">{scene}</p>
                </div>
              )}
              <div className="flex flex-wrap gap-3">
                <div>
                  <p className="text-[11px] font-medium text-stone-500 mb-0.5">Nhân vật</p>
                  {charNames.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {charNames.map((n) => (
                        <span key={n} className="text-[11px] bg-white border border-stone-200 text-stone-700 px-1.5 py-0.5 rounded">
                          {n}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-stone-400">Không gắn nhân vật từ thư viện.</p>
                  )}
                </div>
                {debug?.style && (
                  <div>
                    <p className="text-[11px] font-medium text-stone-500 mb-0.5">Phong cách</p>
                    <span className="inline-flex items-center gap-1 text-[11px] bg-white border border-stone-200 text-stone-700 px-1.5 py-0.5 rounded">
                      <Sparkles className="w-3 h-3 text-storm-500" aria-hidden="true" /> {debug.style}
                    </span>
                  </div>
                )}
              </div>
              {debug?.ragUsed ? (
                <p className="text-[11px] text-storm-600 flex items-center gap-1">
                  <Brain className="w-3.5 h-3.5" aria-hidden="true" /> Đã tham khảo {debug.ragUsed} ảnh đã thích (RAG).
                </p>
              ) : null}
              {debug?.prompt && (
                <div>
                  <button
                    onClick={() => setShowPrompt((v) => !v)}
                    className="flex items-center gap-1 text-[11px] font-medium text-stone-500 hover:text-stone-700"
                  >
                    {showPrompt ? <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" /> : <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />}
                    Xem prompt JSON đã gửi Gemini
                  </button>
                  {showPrompt && (
                    <pre className="text-[10px] leading-snug text-stone-500 bg-white border border-stone-200 rounded-lg p-2 mt-1 overflow-auto max-h-60 whitespace-pre-wrap">
                      {debug.prompt}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}

          {saveErr && <div role="alert" className="ds-alert ds-alert-danger">{saveErr}</div>}
          {saveMsg && <div role="status" className="ds-alert ds-alert-success">{saveMsg}</div>}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              onClick={handleDownload}
              disabled={!url}
              className="ds-btn"
            >
              <Download className="w-4 h-4" aria-hidden="true" /> Tải ảnh
            </button>
            <button
              onClick={() => setShowSaveForm((v) => !v)}
              className="flex items-center gap-1.5 text-sm font-medium text-storm-700 bg-storm-50 hover:bg-storm-100 px-3 py-2 rounded-lg"
            >
              <BookmarkPlus className="w-4 h-4" aria-hidden="true" /> Lưu làm ảnh tham chiếu
            </button>
            {canEdit && (
              <Link
                to={`/studio?postId=${post.id}`}
                className="flex items-center gap-1.5 text-sm font-medium text-stone-700 hover:bg-stone-100 px-3 py-2 rounded-lg"
              >
                <ExternalLink className="w-4 h-4" aria-hidden="true" /> Mở lại để sửa
              </Link>
            )}
            {canDelete && (
              <button
                onClick={() => setConfirmDelete(true)}
                disabled={deleting}
                className="flex items-center gap-1.5 text-sm font-medium text-red-600 bg-red-50 hover:bg-red-100 px-3 py-2 rounded-lg disabled:opacity-50 ml-auto"
              >
                {deleting ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Trash2 className="w-4 h-4" aria-hidden="true" />}
                Xoá ảnh
              </button>
            )}
          </div>

          <ConfirmDialog
            isOpen={confirmDelete}
            title="Xoá ảnh khỏi thư viện?"
            message="Ảnh này sẽ bị xoá vĩnh viễn, không khôi phục được."
            confirmText="Xoá"
            onConfirm={handleDelete}
            onCancel={() => setConfirmDelete(false)}
          />

          {showSaveForm && (
            <div className="flex flex-col gap-2 bg-stone-50 border border-stone-200 rounded-lg p-3">
              <label className="ds-label" htmlFor="save-asset-name">Tên</label>
              <input
                id="save-asset-name"
                value={assetName}
                onChange={(e) => setAssetName(e.target.value)}
                className="ds-input"
              />
              <label className="ds-label" htmlFor="save-asset-kind">Loại</label>
              <select
                id="save-asset-kind"
                value={assetKind}
                onChange={(e) => setAssetKind(e.target.value as AssetKind)}
                className="ds-select"
              >
                <option value="reference">Ảnh tham chiếu</option>
                <option value="meme_template">Ảnh mẫu meme</option>
              </select>
              <label className="flex items-center gap-1.5 text-xs text-stone-500">
                <input type="checkbox" checked={assetShared} onChange={(e) => setAssetShared(e.target.checked)} className="accent-storm-600" />
                Chia sẻ cả nhóm
              </label>
              <button
                onClick={handleSaveAsAsset}
                disabled={saving}
                className="ds-btn ds-btn-primary justify-center"
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

// ===== Tab "Nhân vật" — dàn nhân vật cố định + linh vật =====

const KIND_LABEL: Record<CharacterKind, string> = {
  nguoi: "Người",
  ai: "AI",
  linh_vat: "Linh vật",
};

const KIND_BADGE: Record<CharacterKind, string> = {
  nguoi: "bg-storm-50 text-storm-700",
  ai: "bg-blue-50 text-blue-700",
  linh_vat: "bg-amber-50 text-amber-700",
};

function CharactersTab() {
  const [items, setItems] = useState<CharacterRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formTarget, setFormTarget] = useState<CharacterRow | "new" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CharacterRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"upload" | "generate" | "delete" | null>(null);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      setItems(await listCharacters());
    } catch (e: any) {
      setError(e?.message || "Lỗi tải danh sách nhân vật.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  async function handleUpload(c: CharacterRow, file: File) {
    setBusyId(c.id);
    setBusyAction("upload");
    setError(null);
    try {
      const dataUrl = await fileToDataUrl(file);
      const updated = await updateCharacter(c.id, { refImageDataUrl: dataUrl });
      setItems((prev) => prev.map((x) => (x.id === c.id ? updated : x)));
    } catch (e: any) {
      setError(e?.message || "Tải ảnh thất bại.");
    } finally {
      setBusyId(null);
      setBusyAction(null);
    }
  }

  async function handleGenerate(c: CharacterRow) {
    setBusyId(c.id);
    setBusyAction("generate");
    setError(null);
    try {
      const updated = await generateCharacterReference(c.id);
      setItems((prev) => prev.map((x) => (x.id === c.id ? updated : x)));
    } catch (e: any) {
      setError(e?.message || "AI vẽ ảnh thất bại.");
    } finally {
      setBusyId(null);
      setBusyAction(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setBusyId(deleteTarget.id);
    setBusyAction("delete");
    setError(null);
    try {
      await deleteCharacter(deleteTarget.id);
      setItems((prev) => prev.filter((x) => x.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (e: any) {
      setError(e?.message || "Xoá nhân vật thất bại.");
    } finally {
      setBusyId(null);
      setBusyAction(null);
    }
  }

  const isDemoMode = items.length > 0 && items.every((c) => c.id.startsWith("demo-"));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-sm text-stone-500 max-w-md">
          Dàn nhân vật cố định dùng khi tạo ảnh — thêm/sửa/xoá, tải ảnh reference hoặc để AI vẽ từ mô tả.
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFormTarget("new")}
            className="ds-btn ds-btn-primary"
            disabled={isDemoMode}
            title={isDemoMode ? "Chưa cấu hình DATABASE_URL — chỉ xem được dữ liệu demo." : undefined}
          >
            <Plus className="w-4 h-4" aria-hidden="true" /> Thêm nhân vật mới
          </button>
        </div>
      </div>

      {isDemoMode && (
        <div className="ds-alert ds-alert-warning">
          Đang xem dữ liệu demo tĩnh (thiếu DATABASE_URL) — không thể thêm/sửa/xoá cho tới khi cấu hình DB.
        </div>
      )}
      {error && (
        <div role="alert" className="ds-alert ds-alert-danger">
          {error}
        </div>
      )}

      {loading ? (
        <div className="ds-card">
          <div className="flex items-center justify-center py-16 text-stone-400 gap-2">
            <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> Đang tải...
          </div>
        </div>
      ) : items.length === 0 ? (
        <div className="ds-card">
          <div className="ds-empty">
            <div className="ds-empty-icon">
              <UserRound className="w-8 h-8" aria-hidden="true" />
            </div>
            <p className="ds-empty-title">Chưa có nhân vật nào</p>
            <p className="ds-empty-desc">Thêm nhân vật để dùng làm ảnh tham chiếu khi sáng tạo.</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map((c) => (
            <CharacterCard
              key={c.id}
              character={c}
              disabled={isDemoMode}
              busy={busyId === c.id ? busyAction : null}
              onEdit={() => setFormTarget(c)}
              onDelete={() => setDeleteTarget(c)}
              onUpload={(file) => handleUpload(c, file)}
              onGenerate={() => handleGenerate(c)}
            />
          ))}
        </div>
      )}

      {formTarget && (
        <CharacterForm
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
        title="Xoá nhân vật?"
        message={`Xoá "${deleteTarget?.name}" khỏi thư viện nhân vật? Ảnh reference (nếu có) cũng sẽ bị xoá. Không thể hoàn tác.`}
        confirmText="Xoá"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function CharacterCard({
  character: c,
  disabled,
  busy,
  onEdit,
  onDelete,
  onUpload,
  onGenerate,
}: {
  character: CharacterRow;
  disabled: boolean;
  busy: "upload" | "generate" | "delete" | null;
  onEdit: () => void;
  onDelete: () => void;
  onUpload: (file: File) => void;
  onGenerate: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState(false);
  const busyAny = !!busy;

  return (
    <div className="ds-card hover:border-storm-300 transition-colors">
    <div className="ds-card-body flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <div className="w-16 h-16 rounded-lg overflow-hidden bg-stone-100 border border-stone-200 shrink-0 flex items-center justify-center">
          {c.referenceImageUrl && !c.imageMissing ? (
            <img src={imageDisplayUrl(c.referenceImageUrl) || undefined} alt={c.name} className="w-full h-full object-cover" />
          ) : (
            <UserRound className="w-7 h-7 text-stone-300" aria-hidden="true" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-semibold text-stone-800 truncate">{c.name}</span>
            <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${KIND_BADGE[c.kind]}`}>
              {KIND_LABEL[c.kind]}
            </span>
          </div>
          {c.personality && <p className="text-xs text-stone-500 mt-0.5 line-clamp-2">{c.personality}</p>}
          {c.catchphrase && <p className="text-xs text-storm-600 italic mt-0.5">"{c.catchphrase}"</p>}
        </div>
      </div>

      <div>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-[11px] text-stone-400 hover:text-stone-600 underline underline-offset-2"
        >
          {expanded ? "Ẩn mô tả chi tiết" : "Xem mô tả chi tiết (dùng để vẽ ảnh)"}
        </button>
        {expanded && (
          <p className="text-xs text-stone-500 bg-stone-50 rounded-lg p-2 mt-1 leading-relaxed">
            {c.promptDescription}
          </p>
        )}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap mt-auto pt-1 border-t border-stone-100">
        <button
          onClick={onEdit}
          disabled={disabled || busyAny}
          className="flex items-center gap-1 text-xs font-medium text-stone-600 hover:bg-stone-100 px-2 py-1.5 rounded-lg transition-colors disabled:opacity-50"
          title="Sửa thông tin nhân vật"
        >
          <Pencil className="w-3.5 h-3.5" aria-hidden="true" /> Sửa
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || busyAny}
          className="flex items-center gap-1 text-xs font-medium text-stone-600 hover:bg-stone-100 px-2 py-1.5 rounded-lg transition-colors disabled:opacity-50"
          title="Tải ảnh reference"
        >
          {busy === "upload" ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Upload className="w-3.5 h-3.5" aria-hidden="true" />}
          Tải ảnh
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          aria-label={`Tải ảnh reference cho ${c.name}`}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onUpload(file);
            e.target.value = "";
          }}
        />
        <button
          onClick={onGenerate}
          disabled={disabled || busyAny}
          className="flex items-center gap-1 text-xs font-medium text-storm-700 bg-storm-50 hover:bg-storm-100 px-2 py-1.5 rounded-lg transition-colors disabled:opacity-50"
          title="Dùng AI vẽ ảnh reference từ mô tả"
        >
          {busy === "generate" ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />}
          AI vẽ ảnh
        </button>
        <button
          onClick={onDelete}
          disabled={disabled || busyAny}
          className="flex items-center gap-1 text-xs font-medium text-red-600 hover:bg-red-50 px-2 py-1.5 rounded-lg transition-colors disabled:opacity-50 ml-auto"
          title="Xoá nhân vật"
        >
          {busy === "delete" ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />}
        </button>
      </div>
    </div>
    </div>
  );
}

function CharacterForm({
  initial,
  onClose,
  onSaved,
}: {
  initial: CharacterRow | null;
  onClose: () => void;
  onSaved: (row: CharacterRow) => void;
}) {
  const [name, setName] = useState(initial?.name || "");
  const [kind, setKind] = useState<CharacterKind>(initial?.kind || "nguoi");
  const [promptDescription, setPromptDescription] = useState(initial?.promptDescription || "");
  const [personality, setPersonality] = useState(initial?.personality || "");
  const [catchphrase, setCatchphrase] = useState(initial?.catchphrase || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const input: CharacterInput = {
      name,
      kind,
      promptDescription,
      personality: personality || undefined,
      catchphrase: catchphrase || undefined,
    };
    try {
      const row = initial ? await updateCharacter(initial.id, input) : await createCharacter(input);
      onSaved(row);
    } catch (e: any) {
      setError(e?.message || "Lưu nhân vật thất bại.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ds-modal-overlay open" style={{ zIndex: 100 }}>
      <div className="ds-modal max-w-lg max-h-[90vh] overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="character-form-title">
        <div className="ds-modal-header">
          <h3 id="character-form-title" className="ds-modal-title font-display">
            {initial ? `Sửa nhân vật — ${initial.name}` : "Thêm nhân vật mới"}
          </h3>
          <button onClick={onClose} className="ds-modal-close" aria-label="Đóng">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="ds-modal-body flex flex-col gap-3">
          <div>
            <label className="ds-label" htmlFor="ch-name">Tên nhân vật</label>
            <input
              id="ch-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="ds-input"
            />
          </div>
          <div>
            <label className="ds-label" htmlFor="ch-kind">Loại</label>
            <select
              id="ch-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as CharacterKind)}
              className="ds-select"
            >
              <option value="nguoi">Người</option>
              <option value="ai">AI</option>
              <option value="linh_vat">Linh vật</option>
            </select>
          </div>
          <div>
            <label className="ds-label" htmlFor="ch-prompt">
              Mô tả ngoại hình (dùng để vẽ ảnh)
            </label>
            <textarea
              id="ch-prompt"
              required
              rows={4}
              value={promptDescription}
              onChange={(e) => setPromptDescription(e.target.value)}
              className="ds-textarea"
            />
          </div>
          <div>
            <label className="ds-label" htmlFor="ch-personality">
              Tính cách / vai kể chuyện
            </label>
            <textarea
              id="ch-personality"
              rows={2}
              value={personality}
              onChange={(e) => setPersonality(e.target.value)}
              className="ds-textarea"
            />
          </div>
          <div>
            <label className="ds-label" htmlFor="ch-catchphrase">
              Câu cửa miệng (tuỳ chọn)
            </label>
            <input
              id="ch-catchphrase"
              value={catchphrase}
              onChange={(e) => setCatchphrase(e.target.value)}
              className="ds-input"
            />
          </div>
          {error && <div role="alert" className="ds-alert ds-alert-danger">{error}</div>}
          <button
            type="submit"
            disabled={saving}
            className="ds-btn ds-btn-primary justify-center mt-2"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />} Lưu nhân vật
          </button>
        </form>
      </div>
    </div>
  );
}

// ===== Tab "Phong cách" — thư viện phong cách vẽ (ảnh minh hoạ + mô tả) =====

function StylesTab() {
  const { isAdmin } = useAppContext();
  const [items, setItems] = useState<StyleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formTarget, setFormTarget] = useState<StyleRow | "new" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StyleRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [drawingAll, setDrawingAll] = useState(false);
  const [drawAllProgress, setDrawAllProgress] = useState<string | null>(null);
  const [drawAllResult, setDrawAllResult] = useState<string | null>(null);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      setItems(await listStyles());
    } catch (e: any) {
      setError(e?.message || "Lỗi tải thư viện phong cách.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  async function handleGenerateOne(s: StyleRow) {
    setBusyId(s.id);
    setError(null);
    try {
      const updated = await generateStyleReference(s.id);
      setItems((prev) => prev.map((x) => (x.id === s.id ? updated : x)));
    } catch (e: any) {
      setError(e?.message || "Vẽ minh hoạ thất bại.");
    } finally {
      setBusyId(null);
    }
  }

  // Phân tích lại nét vẽ từ ảnh phong cách (Gemini vision → styleJson).
  async function handleAnalyze(s: StyleRow) {
    setBusyId(s.id);
    setError(null);
    try {
      const updated = await analyzeStyle(s.id);
      setItems((prev) => prev.map((x) => (x.id === s.id ? updated : x)));
    } catch (e: any) {
      setError(e?.message || "Phân tích nét vẽ thất bại.");
    } finally {
      setBusyId(null);
    }
  }

  // Vẽ minh hoạ cả bộ — lặp qua style chưa có ảnh (hoặc ảnh mất file), giống
  // pattern "Vẽ cả bộ" của tab Nhân vật.
  async function handleGenerateAll() {
    const todo = items.filter((s) => !s.referenceImageUrl || s.imageMissing);
    if (todo.length === 0) return;
    setDrawingAll(true);
    setDrawAllResult(null);
    setError(null);
    let okCount = 0;
    const failedNames: string[] = [];
    for (let i = 0; i < todo.length; i++) {
      const s = todo[i];
      setDrawAllProgress(`Đang vẽ ${i + 1}/${todo.length}: ${s.name}...`);
      try {
        const updated = await generateStyleReference(s.id);
        setItems((prev) => prev.map((x) => (x.id === s.id ? updated : x)));
        okCount++;
      } catch (e: any) {
        failedNames.push(s.name);
        console.warn(`[styles] Vẽ minh hoạ cả bộ — lỗi phong cách "${s.name}":`, e?.message || e);
      }
    }
    setDrawAllProgress(null);
    setDrawAllResult(
      failedNames.length
        ? `Xong: vẽ được ${okCount}, lỗi ${failedNames.length} (${failedNames.join(", ")}).`
        : `Xong: vẽ được ${okCount}, lỗi 0.`
    );
    setDrawingAll(false);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteStyle(deleteTarget.id);
      setItems((prev) => prev.filter((x) => x.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (e: any) {
      setError(e?.message || "Xoá phong cách thất bại.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-sm text-stone-500 max-w-md">
          Mỗi phong cách gồm 1 ảnh minh hoạ + mô tả nét vẽ — chọn được ở trang Sáng tạo để ảnh ra đúng phong cách mong muốn.
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={handleGenerateAll}
            disabled={drawingAll || items.every((s) => !!s.referenceImageUrl && !s.imageMissing)}
            className="flex items-center gap-1.5 text-sm font-medium text-storm-700 bg-storm-50 hover:bg-storm-100 px-3 py-2 rounded-lg transition-colors disabled:opacity-60"
            title="Lần lượt vẽ ảnh minh hoạ cho các phong cách chưa có ảnh."
          >
            {drawingAll ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Wand2 className="w-4 h-4" aria-hidden="true" />}
            Vẽ minh hoạ cả bộ
          </button>
          <button
            onClick={() => setFormTarget("new")}
            className="ds-btn ds-btn-primary"
          >
            <Plus className="w-4 h-4" aria-hidden="true" /> Thêm phong cách
          </button>
        </div>
      </div>

      {drawAllProgress && (
        <div role="status" className="ds-alert ds-alert-info">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> {drawAllProgress}
        </div>
      )}
      {drawAllResult && !drawingAll && (
        <div className="text-sm text-stone-700 bg-stone-100 border border-stone-200 rounded-lg px-3 py-2">{drawAllResult}</div>
      )}
      {error && <div role="alert" className="ds-alert ds-alert-danger">{error}</div>}

      {loading ? (
        <div className="ds-card">
          <div className="flex items-center justify-center py-16 text-stone-400 gap-2">
            <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> Đang tải...
          </div>
        </div>
      ) : items.length === 0 ? (
        <div className="ds-card">
          <div className="ds-empty">
            <div className="ds-empty-icon">
              <Sparkles className="w-8 h-8" aria-hidden="true" />
            </div>
            <p className="ds-empty-title">Chưa có phong cách nào</p>
            <p className="ds-empty-desc">Thêm phong cách vẽ để áp dụng nhất quán cho ảnh sáng tạo.</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map((s) => (
            <StyleCard
              key={s.id}
              style={s}
              canManage={s.isMine || (s.isDefault && isAdmin)}
              busy={busyId === s.id}
              onEdit={() => setFormTarget(s)}
              onDelete={() => setDeleteTarget(s)}
              onGenerate={() => handleGenerateOne(s)}
              onAnalyze={() => handleAnalyze(s)}
            />
          ))}
        </div>
      )}

      {formTarget && (
        <StyleForm
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
        title="Xoá phong cách?"
        message={`Xoá phong cách "${deleteTarget?.name}"? Không thể hoàn tác.`}
        confirmText={deleting ? "Đang xoá..." : "Xoá"}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function StyleCard({
  style: s,
  canManage,
  busy,
  onEdit,
  onDelete,
  onGenerate,
  onAnalyze,
}: {
  style: StyleRow;
  canManage: boolean;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onGenerate: () => void;
  onAnalyze: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const img = !s.imageMissing ? imageDisplayUrl(s.referenceImageUrl) : null;
  const fields = Object.entries(s.styleJson || {});
  const hasImage = !!s.referenceImageUrl && !s.imageMissing;

  return (
    <div className="ds-card hover:border-storm-300 transition-colors">
    <div className="ds-card-body flex flex-col gap-3">
      <div className="aspect-video rounded-lg overflow-hidden bg-stone-100 flex items-center justify-center">
        {img ? (
          <img src={img} alt={s.name} className="w-full h-full object-cover" />
        ) : (
          <Sparkles className="w-6 h-6 text-stone-300" aria-hidden="true" />
        )}
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-sm font-semibold text-stone-800 truncate flex-1 min-w-0">{s.name}</span>
        {s.isDefault && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-storm-100 text-storm-700">Mặc định</span>}
        {s.isMine && !s.isDefault && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">Của tôi</span>}
      </div>

      {fields.length === 0 && (
        <p className="ds-alert ds-alert-warning !text-[11px] leading-snug">
          Chưa có mô tả nét vẽ. {hasImage ? 'Bấm "Phân tích lại nét vẽ" để AI đọc ảnh và tạo mô tả.' : "Tải/vẽ ảnh minh hoạ trước rồi phân tích."}
        </p>
      )}

      {fields.length > 0 && (
        <div>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-[11px] text-stone-400 hover:text-stone-600"
          >
            {expanded ? <ChevronUp className="w-3 h-3" aria-hidden="true" /> : <ChevronDown className="w-3 h-3" aria-hidden="true" />}
            {expanded ? "Ẩn mô tả nét vẽ" : "Xem mô tả nét vẽ"}
          </button>
          {expanded && (
            <dl className="text-xs text-stone-500 bg-stone-50 rounded-lg p-2 mt-1 flex flex-col gap-1">
              {fields.map(([k, v]) => (
                <div key={k} className="flex gap-1">
                  <dt className="font-medium text-stone-600 shrink-0">{k}:</dt>
                  <dd className="text-stone-500">{String(v)}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}

      <div className="flex items-center gap-1.5 flex-wrap mt-auto pt-1 border-t border-stone-100">
        <button
          onClick={onGenerate}
          disabled={busy}
          className="flex items-center gap-1 text-xs font-medium text-storm-700 bg-storm-50 hover:bg-storm-100 px-2 py-1.5 rounded-lg transition-colors disabled:opacity-50"
          title="Dùng AI vẽ ảnh minh hoạ từ mô tả nét vẽ"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Wand2 className="w-3.5 h-3.5" aria-hidden="true" />}
          Vẽ minh hoạ
        </button>
        {hasImage && (
          <button
            onClick={onAnalyze}
            disabled={busy}
            className="flex items-center gap-1 text-xs font-medium text-stone-600 hover:bg-stone-100 px-2 py-1.5 rounded-lg transition-colors disabled:opacity-50"
            title="AI đọc ảnh minh hoạ và tạo/cập nhật mô tả nét vẽ (styleJson)"
          >
            <Sparkles className="w-3.5 h-3.5" aria-hidden="true" /> Phân tích nét vẽ
          </button>
        )}
        {canManage && (
          <>
            <button
              onClick={onEdit}
              disabled={busy}
              className="flex items-center gap-1 text-xs font-medium text-stone-600 hover:bg-stone-100 px-2 py-1.5 rounded-lg transition-colors disabled:opacity-50"
              title="Sửa phong cách"
            >
              <Pencil className="w-3.5 h-3.5" aria-hidden="true" /> Sửa
            </button>
            <button
              onClick={onDelete}
              disabled={busy}
              className="flex items-center gap-1 text-xs font-medium text-red-600 hover:bg-red-50 px-2 py-1.5 rounded-lg transition-colors disabled:opacity-50 ml-auto"
              title="Xoá phong cách"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </>
        )}
      </div>
    </div>
    </div>
  );
}

// ===== Tab "RAG" — kho ảnh đã thích (❤️) + hồ sơ sở thích =====

function RagTab() {
  const [scope, setScope] = useState<"all" | "mine" | "shared">("all");
  const [items, setItems] = useState<RagExample[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<RagProfile | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RagExample | null>(null);
  const [deleting, setDeleting] = useState(false);

  function reloadItems(s: "all" | "mine" | "shared") {
    setLoading(true);
    setError(null);
    listRagExamples(s)
      .then(setItems)
      .catch((e) => setError(e?.message || "Lỗi tải thư viện RAG."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    reloadItems(scope);
  }, [scope]);

  useEffect(() => {
    getRagProfile()
      .then(setProfile)
      .catch(() => {
        /* best-effort */
      });
  }, []);

  async function handleRebuild() {
    setRebuilding(true);
    setError(null);
    try {
      const result = await rebuildRagProfile();
      const fresh = await getRagProfile();
      setProfile(fresh);
      if (result.exampleCount === 0) setError("Chưa có ảnh nào được thích — hãy thả tim vài ảnh trước để AI học gu.");
    } catch (e: any) {
      setError(e?.message || "Cập nhật hồ sơ RAG thất bại.");
    } finally {
      setRebuilding(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteRagExample(deleteTarget.id);
      setItems((prev) => prev.filter((x) => x.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (e: any) {
      setError(e?.message || "Xoá ví dụ RAG thất bại.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-stone-500 max-w-2xl">
        Mỗi ảnh bạn thả tim (❤️) được lưu vào đây kèm prompt + thông số. Khi bật <b>RAG</b> ở trang Sáng tạo, AI đọc thêm
        "gu" từ các ảnh này để vẽ hợp ý hơn. Bấm <b>Cập nhật hồ sơ</b> để AI đọc lại toàn bộ ảnh đã thích và chưng cất thành mô tả gu.
      </p>

      {/* Hồ sơ sở thích đã chưng cất */}
      <div className="ds-card">
      <div className="ds-card-body flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-sm font-semibold text-stone-800 flex items-center gap-1.5">
            <Brain className="w-4 h-4 text-storm-600" aria-hidden="true" /> Hồ sơ gu của bạn
          </p>
          <button
            onClick={handleRebuild}
            disabled={rebuilding}
            className="flex items-center gap-1.5 text-xs font-medium text-storm-700 bg-storm-50 hover:bg-storm-100 px-3 py-1.5 rounded-lg disabled:opacity-60"
            title="AI đọc lại các ảnh đã thích và chưng cất thành mô tả gu (phong cách/nền/bố cục hay chọn...)"
          >
            {rebuilding ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />}
            Cập nhật hồ sơ
          </button>
        </div>
        {profile?.profileText ? (
          <p className="text-sm text-stone-600 leading-relaxed bg-stone-50 rounded-lg p-3">{profile.profileText}</p>
        ) : (
          <p className="text-xs text-stone-400">
            Chưa có hồ sơ — thả tim vài ảnh bạn ưng rồi bấm "Cập nhật hồ sơ" để AI học gu.
          </p>
        )}
        {profile && profile.exampleCount > 0 && (
          <p className="text-[11px] text-stone-400">Chưng cất từ {profile.exampleCount} ảnh đã thích.</p>
        )}
      </div>
      </div>

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

      {error && <div role="alert" className="ds-alert ds-alert-danger">{error}</div>}

      {loading ? (
        <div className="ds-card">
          <div className="flex items-center justify-center py-16 text-stone-400 gap-2">
            <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" /> Đang tải...
          </div>
        </div>
      ) : items.length === 0 ? (
        <div className="ds-card">
          <div className="ds-empty">
            <div className="ds-empty-icon">
              <Heart className="w-8 h-8" aria-hidden="true" />
            </div>
            <p className="ds-empty-title">Chưa có ảnh đã thích</p>
            <p className="ds-empty-desc">Vào tab Ảnh (hoặc trang Sáng tạo) và bấm ❤️ trên ảnh bạn ưng.</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {items.map((ex) => {
            const url = imageDisplayUrl(ex.imageUrl);
            const p = ex.paramsJson || {};
            return (
              <div key={ex.id} className="relative rounded-xl overflow-hidden border border-stone-200 bg-white flex flex-col">
                <div className="aspect-square bg-stone-100 flex items-center justify-center">
                  {url ? <img src={url} alt="" className="w-full h-full object-cover" /> : <ImageOff className="w-6 h-6 text-stone-300" aria-hidden="true" />}
                </div>
                <div className="p-2 flex flex-col gap-1 flex-1">
                  {ex.scene && <p className="text-[11px] text-stone-600 line-clamp-2 leading-snug">{ex.scene}</p>}
                  <div className="flex items-center gap-1 flex-wrap mt-auto pt-1">
                    {p.styleName && (
                      <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-storm-50 text-storm-700 truncate max-w-full">{p.styleName}</span>
                    )}
                    {Array.isArray(p.characters) && p.characters.length > 0 && (
                      <span className="text-[9px] text-stone-400 truncate">{p.characters.join(", ")}</span>
                    )}
                  </div>
                  <span className="text-[9px] text-storm-600 font-medium">{ex.isMine ? "Của tôi" : "Chung"}</span>
                </div>
                {ex.isMine && (
                  <button
                    onClick={() => setDeleteTarget(ex)}
                    aria-label="Xoá khỏi RAG"
                    title="Xoá ví dụ này khỏi RAG"
                    className="absolute top-1.5 right-1.5 bg-white/85 hover:bg-red-600 hover:text-white text-stone-500 rounded-full p-1.5 shadow-sm transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        isOpen={!!deleteTarget}
        title="Xoá khỏi thư viện RAG?"
        message="AI sẽ không còn học từ ví dụ này nữa (ảnh gốc trong Thư viện ảnh vẫn giữ)."
        confirmText={deleting ? "Đang xoá..." : "Xoá"}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function StyleForm({
  initial,
  onClose,
  onSaved,
}: {
  initial: StyleRow | null;
  onClose: () => void;
  onSaved: (row: StyleRow) => void;
}) {
  const [name, setName] = useState(initial?.name || "");
  const [isShared, setIsShared] = useState(initial?.isShared || false);
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

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
      setError("Thiếu tên phong cách.");
      return;
    }
    if (!initial && !imageDataUrl) {
      setError("Thiếu ảnh mẫu — bắt buộc khi thêm phong cách mới.");
      return;
    }
    setSaving(true);
    setError(null);
    setWarning(null);
    try {
      const row = initial
        ? await updateStyle(initial.id, { name: name.trim(), isShared, imageDataUrl: imageDataUrl || undefined })
        : await createStyle({ name: name.trim(), isShared, imageDataUrl: imageDataUrl! });
      if ((row as any).warning) setWarning((row as any).warning);
      onSaved(row);
    } catch (e: any) {
      setError(e?.message || "Lưu phong cách thất bại.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ds-modal-overlay open" style={{ zIndex: 100 }}>
      <div className="ds-modal max-w-lg max-h-[90vh] overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="style-form-title">
        <div className="ds-modal-header">
          <h3 id="style-form-title" className="ds-modal-title font-display">
            {initial ? `Sửa phong cách — ${initial.name}` : "Thêm phong cách mới"}
          </h3>
          <button onClick={onClose} className="ds-modal-close" aria-label="Đóng">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="ds-modal-body flex flex-col gap-3">
          <p className="text-xs text-stone-500">
            Tải 1 ảnh mẫu đúng phong cách bạn muốn — hệ thống sẽ tự phân tích nét vẽ (nét, màu, hiệu ứng) để dùng lại khi tạo ảnh.
          </p>
          <div>
            <label className="ds-label" htmlFor="sty-name">Tên phong cách</label>
            <input
              id="sty-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="ds-input"
            />
          </div>
          <label className="flex items-center gap-1.5 text-sm text-stone-600">
            <input type="checkbox" checked={isShared} onChange={(e) => setIsShared(e.target.checked)} className="accent-storm-600" />
            Chia sẻ cả nhóm
          </label>
          <div>
            <label className="ds-label" htmlFor="sty-file">
              Ảnh mẫu {initial ? "(để trống nếu giữ ảnh cũ)" : "(bắt buộc)"}
            </label>
            <div className="flex items-center gap-2">
              <label
                htmlFor="sty-file"
                className="flex items-center gap-1.5 text-xs font-medium text-storm-700 bg-storm-50 hover:bg-storm-100 px-3 py-2 rounded-lg cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" aria-hidden="true" /> Chọn ảnh
              </label>
              <input
                id="sty-file"
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
              ) : initial?.referenceImageUrl && !initial.imageMissing ? (
                <img
                  src={imageDisplayUrl(initial.referenceImageUrl) || undefined}
                  alt="Ảnh hiện tại"
                  className="w-12 h-12 rounded-lg object-cover border border-stone-200"
                />
              ) : (
                <span className="text-xs text-stone-400">Chưa chọn ảnh</span>
              )}
            </div>
          </div>
          {warning && <div className="ds-alert ds-alert-warning">{warning}</div>}
          {error && <div role="alert" className="ds-alert ds-alert-danger">{error}</div>}
          <button
            type="submit"
            disabled={saving}
            className="ds-btn ds-btn-primary justify-center mt-2"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />} Lưu phong cách
          </button>
        </form>
      </div>
    </div>
  );
}
