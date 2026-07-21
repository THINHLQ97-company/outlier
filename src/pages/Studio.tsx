import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, AlertTriangle, Send, RefreshCw, Upload, ImagePlus, Check } from "lucide-react";
import { studioGenerate } from "../services/studio";
import { regenerateImages, selectImage, saveOverlay, submitForApproval } from "../services/posts";
import { listCharacters, fileToDataUrl } from "../services/characters";
import { listAssets, createAsset } from "../services/assets";
import { imageDisplayUrl } from "../services/http";
import type { PostRow, CharacterRow, AssetRow, AxisKey, AssetKind } from "../types";
import { AXES, ART_STYLES, PANEL_LAYOUTS } from "../../shared/engine-data";
import CharacterPicker from "../components/CharacterPicker";
import TextOverlayEditor from "../components/TextOverlayEditor";

const WATERMARK_OPTIONS = ["MATBAO", "MATBAO INVOICE"];
const ASPECT_RATIO_OPTIONS: { value: string; label: string }[] = [
  { value: "1:1", label: "1:1 (vuông)" },
  { value: "3:4", label: "3:4 (dọc)" },
  { value: "9:16", label: "9:16 (dọc cao)" },
];
const MAX_REF_IMAGES = 4; // khớp MAX_REFERENCE_IMAGES ở server/routes/studio.routes.ts

const KIND_BADGE: Record<AssetKind, string> = {
  meme_template: "bg-amber-50 text-amber-700",
  reference: "bg-blue-50 text-blue-700",
};
const KIND_LABEL: Record<AssetKind, string> = {
  meme_template: "Template meme",
  reference: "Tham chiếu",
};

// Studio Vẽ — workspace tạo ảnh trực tiếp từ mô tả tự do, KHÔNG cần tín
// hiệu/kịch bản: mô tả cảnh + trục (tuỳ chọn) + nhân vật + ảnh tham chiếu →
// sinh 2 biến thể → chọn 1 → text-overlay (tái dùng TextOverlayEditor) →
// gửi duyệt / lưu thư viện.
export default function Studio() {
  const navigate = useNavigate();

  // ----- form sinh ảnh -----
  const [promptText, setPromptText] = useState("");
  const [truc, setTruc] = useState<AxisKey | "">("");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [artStyle, setArtStyle] = useState(ART_STYLES[0].key);
  const [panelLayout, setPanelLayout] = useState("1"); // 1/2/4/auto
  const [isShared, setIsShared] = useState(false);
  const [caption, setCaption] = useState("");

  const [characters, setCharacters] = useState<CharacterRow[]>([]);
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<string[]>([]);

  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadShared, setUploadShared] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [generating, setGenerating] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [post, setPost] = useState<PostRow | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listCharacters()
      .then(setCharacters)
      .catch(() => {
        /* best-effort — Studio vẫn dùng được không có nhân vật */
      });
    listAssets()
      .then(setAssets)
      .catch(() => {
        /* best-effort */
      })
      .finally(() => setAssetsLoading(false));
  }, []);

  const totalRefCount = selectedCharacterIds.length + selectedAssetIds.length;

  function toggleCharacter(id: string) {
    setSelectedCharacterIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleAsset(id: string) {
    setSelectedAssetIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function handleUploadAsset(file: File) {
    setUploading(true);
    setError(null);
    try {
      const imageDataUrl = await fileToDataUrl(file);
      const row = await createAsset({
        kind: "reference",
        name: file.name.replace(/\.[a-z0-9]+$/i, "") || "Ảnh tham chiếu",
        imageDataUrl,
        isShared: uploadShared,
      });
      setAssets((prev) => [row, ...prev]);
      setSelectedAssetIds((prev) => [...prev, row.id]);
    } catch (e: any) {
      setError(e?.message || "Upload ảnh tham chiếu thất bại.");
    } finally {
      setUploading(false);
    }
  }

  async function handleGenerate() {
    if (!promptText.trim()) {
      setError("Nhập mô tả cảnh trước khi tạo ảnh.");
      return;
    }
    setGenerating(true);
    setError(null);
    setWarning(null);
    try {
      const result = await studioGenerate({
        promptText: promptText.trim(),
        truc: truc || null,
        characterIds: selectedCharacterIds,
        assetIds: selectedAssetIds,
        aspectRatio,
        artStyle,
        panelLayout,
        isShared,
        caption: caption.trim() || undefined,
      });
      setPost(result);
      if ((result as any).warning) setWarning((result as any).warning);
    } catch (e: any) {
      setError(e?.message || "Tạo ảnh thất bại.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleRegenerate() {
    if (!post) return;
    setRegenerating(true);
    setError(null);
    setWarning(null);
    try {
      const result = await regenerateImages(post.id);
      setPost(result);
      if ((result as any).warning) setWarning((result as any).warning);
    } catch (e: any) {
      setError(e?.message || "Vẽ lại ảnh thất bại.");
    } finally {
      setRegenerating(false);
    }
  }

  async function handleSelectImage(url: string) {
    if (!post) return;
    setSelecting(true);
    setError(null);
    try {
      setPost(await selectImage(post.id, url));
    } catch (e: any) {
      setError(e?.message || "Chọn ảnh thất bại.");
    } finally {
      setSelecting(false);
    }
  }

  async function handleExport(overlay: any, finalImageDataUrl: string) {
    if (!post) return;
    setExporting(true);
    setError(null);
    try {
      setPost(await saveOverlay(post.id, overlay, finalImageDataUrl, caption));
    } catch (e: any) {
      setError(e?.message || "Lưu overlay thất bại.");
    } finally {
      setExporting(false);
    }
  }

  async function handleSubmit() {
    if (!post) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitForApproval(post.id);
      navigate("/approval");
    } catch (e: any) {
      setError(e?.message || "Gửi duyệt thất bại.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <div>
        <h1 className="text-lg font-bold text-stone-800 font-display">Studio Vẽ</h1>
        <p className="text-sm text-stone-500">
          Tự viết mô tả cảnh, chọn nhân vật + ảnh tham chiếu → sinh ảnh trực tiếp, không cần tín hiệu/kịch bản.
        </p>
      </div>

      {!post && (
        <div className="flex flex-col gap-4 bg-white border border-stone-200 rounded-xl p-4">
          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1" htmlFor="st-prompt">
              Mô tả cảnh (kịch bản tự do)
            </label>
            <textarea
              id="st-prompt"
              rows={4}
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              placeholder="VD: Gàn ngồi trước 2 nút to 'AI làm hộ' và 'Tự làm', mồ hôi nhễ nhại, Gèn đứng sau lắc đầu..."
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1" htmlFor="st-truc">Trục (tuỳ chọn)</label>
            <select
              id="st-truc"
              value={truc}
              onChange={(e) => setTruc(e.target.value as AxisKey | "")}
              className="rounded-lg border border-stone-300 px-3 py-2 text-sm"
            >
              <option value="">Không gắn trục</option>
              {(Object.keys(AXES) as AxisKey[]).map((k) => (
                <option key={k} value={k}>{AXES[k].label}</option>
              ))}
            </select>
          </div>

          <div>
            <p className="text-xs font-medium text-stone-600 mb-1.5">Chọn nhân vật (tuỳ chọn)</p>
            <CharacterPicker characters={characters} selectedIds={selectedCharacterIds} onToggle={toggleCharacter} />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs font-medium text-stone-600">Ảnh tham chiếu (tuỳ chọn)</p>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="flex items-center gap-1 text-xs font-medium text-storm-700 bg-storm-50 hover:bg-storm-100 px-2 py-1 rounded-lg disabled:opacity-60"
              >
                {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Upload className="w-3.5 h-3.5" aria-hidden="true" />}
                Upload & lưu tham chiếu
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                aria-label="Upload ảnh tham chiếu mới"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleUploadAsset(file);
                  e.target.value = "";
                }}
              />
            </div>
            <label className="flex items-center gap-1.5 text-xs text-stone-500 mb-2">
              <input type="checkbox" checked={uploadShared} onChange={(e) => setUploadShared(e.target.checked)} className="accent-storm-600" />
              Ảnh upload mới chia sẻ cho team
            </label>
            {assetsLoading ? (
              <div className="flex items-center gap-2 text-stone-400 text-xs py-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Đang tải kho tham chiếu...
              </div>
            ) : assets.length === 0 ? (
              <p className="text-xs text-stone-400">Chưa có ảnh tham chiếu nào — dùng nút upload ở trên.</p>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {assets.map((a) => {
                  const selected = selectedAssetIds.includes(a.id);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => toggleAsset(a.id)}
                      aria-pressed={selected}
                      className={`relative rounded-lg overflow-hidden border-2 text-left transition-colors ${
                        selected ? "border-storm-500" : "border-transparent hover:border-storm-200"
                      }`}
                    >
                      <img
                        src={imageDisplayUrl(a.imageUrl) || undefined}
                        alt={a.name}
                        className="w-full h-20 object-cover bg-stone-100"
                      />
                      {selected && (
                        <span className="absolute top-1 right-1 bg-storm-600 text-white rounded-full p-0.5">
                          <Check className="w-3 h-3" aria-hidden="true" />
                        </span>
                      )}
                      <div className="absolute inset-x-0 bottom-0 bg-black/55 px-1.5 py-1 flex items-center justify-between gap-1">
                        <span className="text-white text-[10px] truncate">{a.name}</span>
                        <span className={`text-[9px] font-medium px-1 rounded ${KIND_BADGE[a.kind]}`}>{KIND_LABEL[a.kind]}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
            {totalRefCount > MAX_REF_IMAGES && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mt-2 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                Đang chọn {totalRefCount} ảnh — chỉ {MAX_REF_IMAGES} ảnh đầu (nhân vật trước, asset sau) được dùng làm tham chiếu.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1" htmlFor="st-style">Phong cách vẽ</label>
              <select
                id="st-style"
                value={artStyle}
                onChange={(e) => setArtStyle(e.target.value)}
                className="rounded-lg border border-stone-300 px-3 py-2 text-sm"
              >
                {ART_STYLES.map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1" htmlFor="st-layout">Bố cục / số khung</label>
              <select
                id="st-layout"
                value={panelLayout}
                onChange={(e) => setPanelLayout(e.target.value)}
                className="rounded-lg border border-stone-300 px-3 py-2 text-sm"
              >
                {PANEL_LAYOUTS.map((l) => (
                  <option key={l.key} value={l.key}>{l.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-600 mb-1" htmlFor="st-ratio">Tỉ lệ khung</label>
              <select
                id="st-ratio"
                value={aspectRatio}
                onChange={(e) => setAspectRatio(e.target.value)}
                className="rounded-lg border border-stone-300 px-3 py-2 text-sm"
              >
                {ASPECT_RATIO_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-1.5 text-sm text-stone-600 pb-2.5">
              <input type="checkbox" checked={isShared} onChange={(e) => setIsShared(e.target.checked)} className="accent-storm-600" />
              Chia sẻ team (bỏ chọn = chỉ mình tôi)
            </label>
          </div>
          {panelLayout === "auto" && !selectedAssetIds.length && (
            <p className="text-[11px] text-amber-700 -mt-1">
              "Theo ảnh mẫu" cần đính 1 ảnh template meme ở phần Ảnh tham chiếu bên trên.
            </p>
          )}

          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1" htmlFor="st-caption">Caption (tuỳ chọn)</label>
            <textarea
              id="st-caption"
              rows={2}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
            />
          </div>

          <button
            onClick={handleGenerate}
            disabled={generating}
            className="self-start flex items-center gap-1.5 text-sm font-medium text-white bg-storm-600 hover:bg-storm-700 px-4 py-2.5 rounded-lg disabled:opacity-60"
          >
            {generating ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <ImagePlus className="w-4 h-4" aria-hidden="true" />}
            Tạo ảnh
          </button>
        </div>
      )}

      {post && (
        <button
          onClick={handleRegenerate}
          disabled={regenerating}
          className="self-start flex items-center gap-1.5 text-sm font-medium text-storm-700 bg-storm-50 hover:bg-storm-100 px-3 py-2 rounded-lg disabled:opacity-60"
          title="Vẽ lại 2 biến thể ảnh mới (giữ nguyên mô tả/nhân vật/tham chiếu), ảnh cũ sẽ bị xoá."
        >
          {regenerating ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="w-4 h-4" aria-hidden="true" />}
          Vẽ lại 2 biến thể
        </button>
      )}

      {warning && (
        <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>{warning}</span>
        </div>
      )}
      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      {post && !post.selectedImageUrl && (
        <div className="grid grid-cols-2 gap-3">
          {post.imageVariants.map((v, i) => (
            <button
              key={i}
              onClick={() => handleSelectImage(v.url)}
              disabled={selecting}
              className="relative rounded-xl overflow-hidden border-2 border-transparent hover:border-storm-200 transition-colors"
            >
              <img
                src={imageDisplayUrl(v.url) || undefined}
                alt={`Biến thể ảnh ${i + 1}`}
                className="w-full object-cover bg-stone-100"
                style={{ aspectRatio: (post.overlayJson?.aspectRatio || "1:1").replace(":", " / ") }}
              />
            </button>
          ))}
        </div>
      )}

      {post && post.selectedImageUrl && (
        <div className="flex flex-col gap-3">
          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1" htmlFor="st-caption-2">
              Caption (≤ 2 câu, không giải thích trò đùa)
            </label>
            <textarea
              id="st-caption-2"
              rows={2}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
            />
          </div>
          <TextOverlayEditor
            imageUrl={imageDisplayUrl(post.selectedImageUrl) || post.selectedImageUrl}
            initialOverlay={post.overlayJson}
            watermarkOptions={WATERMARK_OPTIONS}
            onExport={handleExport}
            exporting={exporting}
            aspectRatio={post.overlayJson?.aspectRatio || "1:1"}
          />

          {post.finalImageUrl && (
            <div className="flex flex-col gap-3 border-t border-stone-200 pt-4">
              <p className="text-xs font-medium text-stone-500">Ảnh cuối đã lưu (cũng có trong Thư viện):</p>
              <img
                src={imageDisplayUrl(post.finalImageUrl) || undefined}
                alt="Ảnh cuối kèm watermark"
                className="w-full max-w-sm rounded-xl border border-stone-200"
              />
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="self-start flex items-center gap-1.5 text-sm font-medium text-white bg-storm-700 hover:bg-storm-800 px-4 py-2.5 rounded-lg disabled:opacity-60"
              >
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Send className="w-4 h-4" aria-hidden="true" />}
                Gửi vào duyệt
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
