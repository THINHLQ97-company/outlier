import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Loader2,
  AlertTriangle,
  RefreshCw,
  Upload,
  ImagePlus,
  Check,
  Plus,
  X,
  Trash2,
  CheckCircle2,
  Sparkles,
  ChevronUp,
  ChevronDown,
  Heart,
  Brain,
  UserRound,
} from "lucide-react";
import { studioGenerate, suggestScenario, type ScenarioVariant } from "../services/studio";
import { regenerateImages, selectImage, saveOverlay, getPost, editImage, revertImage } from "../services/posts";
import { favoriteImage, unfavoriteImage, getFavoriteIds } from "../services/rag";
import { listCharacters, fileToDataUrl } from "../services/characters";
import { listAssets, createAsset, deleteAsset } from "../services/assets";
import { listStyles } from "../services/styles";
import { imageDisplayUrl } from "../services/http";
import type { PostRow, CharacterRow, AssetRow, AssetKind, StyleRow, DialogueLine } from "../types";
import { PANEL_LAYOUTS, BACKGROUND_OPTIONS } from "../../shared/engine-data";
import CharacterPicker from "../components/CharacterPicker";
import TextOverlayEditor from "../components/TextOverlayEditor";

const WATERMARK_OPTIONS = ["MATBAO", "MATBAO INVOICE"];
const ASPECT_RATIO_OPTIONS: { value: string; label: string }[] = [
  { value: "1:1", label: "1:1 (vuông)" },
  { value: "3:4", label: "3:4 (dọc)" },
  { value: "9:16", label: "9:16 (dọc cao)" },
];
// Mỗi nhân vật/ảnh tham chiếu đều được đính ảnh mẫu để giữ đúng nét → giới hạn
// bằng ngân sách ảnh của model: MAX_REFERENCE_IMAGES=6 (prompt-builder) trừ 1 chỗ
// cho ảnh mẫu meme (phong cách nay dùng MÔ TẢ text, không chiếm chỗ ảnh).
const MAX_PEOPLE_REF = 5;

const KIND_BADGE: Record<AssetKind, string> = {
  meme_template: "bg-amber-50 text-amber-700",
  reference: "bg-blue-50 text-blue-700",
};
const KIND_LABEL: Record<AssetKind, string> = {
  meme_template: "Ảnh mẫu meme",
  reference: "Tham chiếu",
};

// Studio "Sáng tạo" — bố cục 2 cột. Cột trái: nhân vật + ảnh tham chiếu. Cột
// phải: mô tả bối cảnh, lời thoại, phong cách, bố cục/tỉ lệ khung. Sau khi tạo
// ảnh: chọn 1 trong 2 biến thể → chỉnh chữ (TextOverlayEditor) → lưu, ảnh nằm
// thẳng trong Thư viện (không còn khâu gửi duyệt).
export default function Studio() {
  // ----- cột trái: nhân vật + ảnh tham chiếu -----
  const [characters, setCharacters] = useState<CharacterRow[]>([]);
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<string[]>([]);
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [assetsLoading, setAssetsLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadShared, setUploadShared] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ----- cột phải: nội dung + phong cách -----
  const [promptText, setPromptText] = useState("");
  const [dialogueLines, setDialogueLines] = useState<DialogueLine[]>([]);
  const [styles, setStyles] = useState<StyleRow[]>([]);
  const [stylesLoading, setStylesLoading] = useState(true);
  const [styleId, setStyleId] = useState<string | null>(null);
  const [panelLayout, setPanelLayout] = useState("1"); // 1/2/4/auto
  const [background, setBackground] = useState("scene"); // scene/white/minimal
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [isShared, setIsShared] = useState(false);
  const [useRag, setUseRag] = useState(false); // bật RAG: đọc thêm "gu đã học"

  const [generating, setGenerating] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [caption, setCaption] = useState("");
  const [post, setPost] = useState<PostRow | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [searchParams] = useSearchParams();
  const [loadingExisting, setLoadingExisting] = useState(false);

  // ----- RAG: trạng thái đã thả tim ảnh hiện tại -----
  const [favorited, setFavorited] = useState(false);
  const [favoriting, setFavoriting] = useState(false);

  // Mở lại 1 bài đã có (link "Mở lại để sửa" từ Thư viện, ?postId=<id>) — bỏ
  // qua form chọn nhân vật/mô tả, đi thẳng vào bước chọn ảnh/chỉnh chữ (post đã
  // có sẵn imageVariants). Chỉ áp dụng cho bài đang ở khâu VẼ (draft/sua_thoai).
  // Điền sẵn mô tả bối cảnh khi mở từ Tín hiệu ("Đưa sang Sáng tạo" → ?scene=...).
  useEffect(() => {
    const scene = searchParams.get("scene");
    if (scene && !searchParams.get("postId")) setPromptText(scene);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const postId = searchParams.get("postId");
    if (!postId) return;
    setLoadingExisting(true);
    setError(null);
    getPost(postId)
      .then((row) => {
        if (row.status === "draft" || row.status === "sua_thoai") {
          setPost(row);
          setCaption(row.caption || "");
        } else {
          setError(`Bài này đang ở trạng thái "${row.status}", không mở lại sửa được ở Studio.`);
        }
      })
      .catch((e: any) => setError(e?.message || "Không tải được bài đã lưu."))
      .finally(() => setLoadingExisting(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    listStyles()
      .then(setStyles)
      .catch(() => {
        /* best-effort — vẫn tạo ảnh được bằng phong cách mặc định phía server */
      })
      .finally(() => setStylesLoading(false));
  }, []);

  // Đồng bộ trạng thái "đã thả tim" cho ảnh hiện tại (khi tạo mới / mở lại bài).
  useEffect(() => {
    if (!post?.id) {
      setFavorited(false);
      return;
    }
    getFavoriteIds()
      .then((ids) => setFavorited(ids.includes(post.id)))
      .catch(() => {
        /* best-effort */
      });
  }, [post?.id]);

  async function handleToggleFavorite() {
    if (!post) return;
    setFavoriting(true);
    setError(null);
    try {
      if (favorited) {
        await unfavoriteImage(post.id);
        setFavorited(false);
      } else {
        await favoriteImage(post.id, post.isShared);
        setFavorited(true);
      }
    } catch (e: any) {
      setError(e?.message || "Thao tác yêu thích thất bại.");
    } finally {
      setFavoriting(false);
    }
  }

  const selectedCharacters = characters.filter((c) => selectedCharacterIds.includes(c.id));
  // Nhân vật + ảnh tham chiếu (KHÔNG tính ảnh mẫu meme) dùng chung ngân sách ảnh
  // của model. Mỗi cái đều PHẢI có ảnh mẫu để giữ đúng nét → chặn ở MAX_PEOPLE_REF.
  const selectedRefAssetCount = selectedAssetIds.filter(
    (id) => assets.find((a) => a.id === id)?.kind !== "meme_template"
  ).length;
  const refUsed = selectedCharacterIds.length + selectedRefAssetCount;
  const refFull = refUsed >= MAX_PEOPLE_REF;

  function toggleCharacter(id: string) {
    const isSelected = selectedCharacterIds.includes(id);
    if (!isSelected && refFull) {
      setError(`Tối đa ${MAX_PEOPLE_REF} nhân vật/ảnh tham chiếu trong 1 ảnh — bỏ bớt để chọn thêm.`);
      return;
    }
    setError(null);
    setSelectedCharacterIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      // Bỏ chọn nhân vật → xoá luôn dòng thoại đang gán cho nhân vật đó.
      if (prev.includes(id)) {
        const name = characters.find((c) => c.id === id)?.name;
        if (name) setDialogueLines((lines) => lines.filter((l) => l.character !== name));
      }
      return next;
    });
  }

  function toggleAsset(id: string) {
    const isSelected = selectedAssetIds.includes(id);
    const isMeme = assets.find((a) => a.id === id)?.kind === "meme_template";
    if (!isSelected && !isMeme && refFull) {
      setError(`Tối đa ${MAX_PEOPLE_REF} nhân vật/ảnh tham chiếu trong 1 ảnh — bỏ bớt để chọn thêm.`);
      return;
    }
    setError(null);
    setSelectedAssetIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const [deletingAssetId, setDeletingAssetId] = useState<string | null>(null);
  async function handleDeleteAsset(id: string) {
    setDeletingAssetId(id);
    setError(null);
    try {
      await deleteAsset(id);
      setAssets((prev) => prev.filter((a) => a.id !== id));
      setSelectedAssetIds((prev) => prev.filter((x) => x !== id));
    } catch (e: any) {
      setError(e?.message || "Xoá ảnh tham chiếu thất bại.");
    } finally {
      setDeletingAssetId(null);
    }
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
      setError(e?.message || "Tải ảnh tham chiếu thất bại.");
    } finally {
      setUploading(false);
    }
  }

  function addDialogueLine() {
    const defaultCharacter = selectedCharacters[0]?.name || "";
    setDialogueLines((prev) => [...prev, { character: defaultCharacter, text: "" }]);
  }
  function updateDialogueLine(index: number, patch: Partial<DialogueLine>) {
    setDialogueLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }
  function removeDialogueLine(index: number) {
    setDialogueLines((prev) => prev.filter((_, i) => i !== index));
  }

  // ----- AI viết kịch bản hài -----
  const [suggesting, setSuggesting] = useState(false);
  const [scenarios, setScenarios] = useState<ScenarioVariant[] | null>(null);
  const [suggestWarning, setSuggestWarning] = useState<string | null>(null);

  async function handleSuggestScenario() {
    if (!promptText.trim()) {
      setError("Nhập một ý tưởng/chủ đề trước để AI viết kịch bản.");
      return;
    }
    setSuggesting(true);
    setError(null);
    setSuggestWarning(null);
    try {
      const hintNames = selectedCharacters.map((c) => c.name);
      const result = await suggestScenario(promptText.trim(), hintNames);
      setScenarios(result.variants);
      if (result.warning) setSuggestWarning(result.warning);
    } catch (e: any) {
      setError(e?.message || "AI viết kịch bản thất bại.");
    } finally {
      setSuggesting(false);
    }
  }

  // Áp 1 phương án AI vào form: mô tả + nhân vật (map tên→id) + lời thoại + bố cục.
  function applyScenario(v: ScenarioVariant) {
    setPromptText(v.scene || promptText);
    const ids = v.characters
      .map((name) => characters.find((c) => c.name === name)?.id)
      .filter((x): x is string => !!x);
    if (ids.length) setSelectedCharacterIds(ids);
    setDialogueLines(v.dialogue || []);
    if (v.panelLayout === "1" || v.panelLayout === "2") setPanelLayout(v.panelLayout);
    setScenarios(null);
  }

  async function handleGenerate() {
    if (!promptText.trim()) {
      setError("Nhập mô tả bối cảnh trước khi tạo ảnh.");
      return;
    }
    setGenerating(true);
    setError(null);
    setWarning(null);
    try {
      const cleanDialogue = dialogueLines.filter((l) => l.character.trim() && l.text.trim());
      const result = await studioGenerate({
        promptText: promptText.trim(),
        characterIds: selectedCharacterIds,
        assetIds: selectedAssetIds,
        styleId,
        dialogue: cleanDialogue,
        panelLayout,
        background,
        aspectRatio,
        useRag,
        isShared,
      });
      setPost(result);
      if ((result as any).warning) setWarning((result as any).warning);
    } catch (e: any) {
      setError(e?.message || "Tạo ảnh thất bại.");
    } finally {
      setGenerating(false);
    }
  }

  function handleReset() {
    setPost(null);
    setCaption("");
    setWarning(null);
    setError(null);
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
      setError(e?.message || "Lưu ảnh thất bại.");
    } finally {
      setExporting(false);
    }
  }

  // Vòng chỉnh sửa bằng câu lệnh (như ChatGPT): gõ câu chỉnh → Gemini sửa trên
  // ảnh hiện tại → lặp tới khi ưng.
  const [editInstruction, setEditInstruction] = useState("");
  const [editing, setEditing] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [showFinish, setShowFinish] = useState(false);
  async function handleEditImage() {
    if (!post || !editInstruction.trim()) return;
    setEditing(true);
    setError(null);
    try {
      const updated = await editImage(post.id, editInstruction.trim());
      setPost(updated);
      setEditInstruction("");
    } catch (e: any) {
      setError(e?.message || "Chỉnh ảnh thất bại.");
    } finally {
      setEditing(false);
    }
  }
  async function handleRevert(url: string) {
    if (!post) return;
    setReverting(true);
    setError(null);
    try {
      setPost(await revertImage(post.id, url));
    } catch (e: any) {
      setError(e?.message || "Quay lại ảnh thất bại.");
    } finally {
      setReverting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5 max-w-5xl">
      <div>
        <h1 className="text-lg font-bold text-stone-800 font-display">Sáng tạo</h1>
        <p className="text-sm text-stone-500">
          Chọn nhân vật + ảnh tham chiếu, mô tả bối cảnh và chọn phong cách để tạo ảnh cho fanpage.
        </p>
      </div>

      {loadingExisting && (
        <div className="flex items-center gap-2 text-stone-400 text-sm py-4">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Đang mở lại bài đã lưu...
        </div>
      )}

      {!post && !loadingExisting && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* CỘT TRÁI — nhân vật & ảnh tham chiếu */}
          <div className="flex flex-col gap-4 bg-white border border-stone-200 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-stone-800">Nhân vật & ảnh tham chiếu</h2>

            <div>
              <p className="text-xs font-medium text-stone-600 mb-1.5">Chọn nhân vật (tuỳ chọn)</p>
              <CharacterPicker
                characters={characters}
                selectedIds={selectedCharacterIds}
                onToggle={toggleCharacter}
                disableUnselected={refFull}
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-xs font-medium text-stone-600">Ảnh tham chiếu / ảnh mẫu meme (tuỳ chọn)</p>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex items-center gap-1 text-xs font-medium text-storm-700 bg-storm-50 hover:bg-storm-100 px-2 py-1 rounded-lg disabled:opacity-60"
                >
                  {uploading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                  Tải ảnh tham chiếu
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  aria-label="Tải ảnh tham chiếu mới"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleUploadAsset(file);
                    e.target.value = "";
                  }}
                />
              </div>
              <label className="flex items-center gap-1.5 text-xs text-stone-500 mb-1">
                <input
                  type="checkbox"
                  checked={uploadShared}
                  onChange={(e) => setUploadShared(e.target.checked)}
                  className="accent-storm-600"
                />
                Ảnh tải lên mới chia sẻ cho cả nhóm
              </label>
              <p className="text-[11px] text-stone-400 mb-2 leading-snug">
                Ảnh tham chiếu bạn tải lên được <b>lưu lại để tái dùng</b> cho các lần tạo ảnh sau (mới nhất xếp trước). Bấm{" "}
                <Trash2 className="w-3 h-3 inline align-text-bottom" aria-hidden="true" /> để xoá ảnh không cần nữa.
              </p>
              {assetsLoading ? (
                <div className="flex items-center gap-2 text-stone-400 text-xs py-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Đang tải kho ảnh...
                </div>
              ) : assets.length === 0 ? (
                <p className="text-xs text-stone-400">Chưa có ảnh nào trong kho — dùng nút "Tải ảnh tham chiếu" ở trên.</p>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {assets.map((a) => {
                    const selected = selectedAssetIds.includes(a.id);
                    return (
                      <div
                        key={a.id}
                        className={`relative rounded-lg overflow-hidden border-2 transition-colors ${
                          selected ? "border-storm-500" : "border-transparent hover:border-storm-200"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => toggleAsset(a.id)}
                          aria-pressed={selected}
                          title={`${a.name} — ${KIND_LABEL[a.kind]}${a.kind === "meme_template" ? " (đính làm ảnh mẫu bố cục)" : ""}`}
                          className="block w-full text-left"
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
                        {a.isMine && (
                          <button
                            type="button"
                            onClick={() => handleDeleteAsset(a.id)}
                            disabled={deletingAssetId === a.id}
                            aria-label={`Xoá ảnh tham chiếu ${a.name}`}
                            title="Xoá ảnh tham chiếu này"
                            className="absolute top-1 left-1 bg-black/55 hover:bg-red-600 text-white rounded-full p-1 transition-colors disabled:opacity-50"
                          >
                            {deletingAssetId === a.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                            ) : (
                              <Trash2 className="w-3 h-3" aria-hidden="true" />
                            )}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <p className="text-[11px] text-stone-400 mt-2 leading-snug">
                Đang chọn {refUsed}/{MAX_PEOPLE_REF} nhân vật &amp; ảnh tham chiếu. Mỗi cái đều được đính ảnh mẫu để giữ đúng nét —
                model ảnh chỉ giữ được đúng chừng đó (ảnh mẫu meme + phong cách tính riêng).
                {refFull && <span className="text-amber-700 font-medium"> Đã đủ — bỏ bớt để chọn cái khác.</span>}
              </p>
              {panelLayout === "auto" && !selectedAssetIds.some((id) => assets.find((a) => a.id === id)?.kind === "meme_template") && (
                <p className="text-[11px] text-amber-700 mt-2">
                  Bố cục "Theo ảnh mẫu" cần chọn 1 ảnh mẫu meme ở trên (huy hiệu "Ảnh mẫu meme").
                </p>
              )}
            </div>

            {(selectedCharacters.length > 0 || selectedAssetIds.length > 0) && (
              <div className="pt-2 border-t border-stone-100">
                <p className="text-[11px] text-stone-400 mb-1.5">Đang dùng làm tham chiếu:</p>
                <div className="flex flex-wrap gap-1.5">
                  {selectedCharacters.map((c) => (
                    <span key={c.id} className="flex items-center gap-1 text-[11px] bg-storm-50 text-storm-700 px-1.5 py-1 rounded-lg">
                      <span className="w-4 h-4 rounded-full overflow-hidden bg-stone-100 shrink-0">
                        {c.referenceImageUrl && (
                          <img src={imageDisplayUrl(c.referenceImageUrl) || undefined} alt="" className="w-full h-full object-cover" />
                        )}
                      </span>
                      {c.name}
                    </span>
                  ))}
                  {assets
                    .filter((a) => selectedAssetIds.includes(a.id))
                    .map((a) => (
                      <span key={a.id} className="flex items-center gap-1 text-[11px] bg-stone-100 text-stone-600 px-1.5 py-1 rounded-lg">
                        <img src={imageDisplayUrl(a.imageUrl) || undefined} alt="" className="w-4 h-4 rounded object-cover shrink-0" />
                        {a.name}
                      </span>
                    ))}
                </div>
              </div>
            )}
          </div>

          {/* CỘT PHẢI — nội dung & phong cách */}
          <div className="flex flex-col gap-4 bg-white border border-stone-200 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-stone-800">Nội dung & phong cách</h2>

            <div>
              <div className="flex items-center justify-between mb-1 gap-2">
                <label className="block text-xs font-medium text-stone-600" htmlFor="st-prompt">
                  Mô tả bối cảnh
                </label>
                <button
                  type="button"
                  onClick={handleSuggestScenario}
                  disabled={suggesting}
                  title="Nhập ý tưởng/chủ đề thô, AI sẽ viết thành kịch bản hài (bối cảnh + nhân vật + lời thoại)"
                  className="flex items-center gap-1 text-xs font-medium text-storm-700 bg-storm-50 hover:bg-storm-100 px-2 py-1 rounded-lg disabled:opacity-60"
                >
                  {suggesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />}
                  AI viết kịch bản hài
                </button>
              </div>
              <textarea
                id="st-prompt"
                rows={4}
                value={promptText}
                onChange={(e) => setPromptText(e.target.value)}
                placeholder="Gõ ý tưởng/chủ đề thô (VD: ChatGPT hay bịa số liệu) rồi bấm 'AI viết kịch bản hài' để dựng cảnh cụ thể — hoặc tự mô tả chi tiết bối cảnh."
                className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
              />
              {suggestWarning && (
                <p className="text-[11px] text-amber-700 mt-1">{suggestWarning}</p>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-xs font-medium text-stone-600">Lời thoại (tuỳ chọn)</p>
                <button
                  type="button"
                  onClick={addDialogueLine}
                  disabled={selectedCharacters.length === 0}
                  title={selectedCharacters.length === 0 ? "Chọn nhân vật ở cột bên trái trước" : undefined}
                  className="flex items-center gap-1 text-xs font-medium text-storm-700 bg-storm-50 hover:bg-storm-100 px-2 py-1 rounded-lg disabled:opacity-50"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Thêm lời thoại
                </button>
              </div>
              {selectedCharacters.length === 0 ? (
                <p className="text-xs text-stone-400">Chọn nhân vật ở cột bên trái để gắn lời thoại.</p>
              ) : dialogueLines.length === 0 ? (
                <p className="text-xs text-stone-400">Chưa có lời thoại — ảnh sẽ được chừa chỗ để bạn tự thêm chữ sau.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {dialogueLines.map((line, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <select
                        aria-label={`Nhân vật nói dòng thoại ${i + 1}`}
                        value={line.character}
                        onChange={(e) => updateDialogueLine(i, { character: e.target.value })}
                        className="rounded-lg border border-stone-300 px-2 py-1.5 text-xs shrink-0 w-28"
                      >
                        {selectedCharacters.map((c) => (
                          <option key={c.id} value={c.name}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      <input
                        aria-label={`Nội dung lời thoại ${i + 1}`}
                        value={line.text}
                        onChange={(e) => updateDialogueLine(i, { text: e.target.value })}
                        placeholder="Nội dung câu thoại..."
                        className="flex-1 rounded-lg border border-stone-300 px-2.5 py-1.5 text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => removeDialogueLine(i)}
                        className="shrink-0 p-1.5 text-stone-400 hover:bg-stone-100 rounded-lg"
                        aria-label={`Xoá lời thoại ${i + 1}`}
                        title="Xoá dòng thoại này"
                      >
                        <X className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  ))}
                  <p className="text-[11px] text-stone-400">
                    Lưu ý: mô hình vẽ AI có thể sai dấu tiếng Việt trong bong bóng thoại — kiểm tra lại và sửa ở bước chỉnh chữ sau khi tạo ảnh.
                  </p>
                </div>
              )}
            </div>

            <div>
              <p className="text-xs font-medium text-stone-600 mb-1.5">Phong cách vẽ</p>
              {stylesLoading ? (
                <div className="flex items-center gap-2 text-stone-400 text-xs py-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Đang tải thư viện phong cách...
                </div>
              ) : styles.length === 0 ? (
                <p className="text-xs text-stone-400">Chưa có phong cách nào — hệ thống sẽ dùng phong cách mặc định.</p>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {styles.map((s) => {
                    const selected = styleId === s.id;
                    const img = !s.imageMissing ? imageDisplayUrl(s.referenceImageUrl) : null;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => setStyleId(selected ? null : s.id)}
                        aria-pressed={selected}
                        title={s.name}
                        className={`relative rounded-lg overflow-hidden border-2 text-left transition-colors ${
                          selected ? "border-storm-500" : "border-transparent hover:border-storm-200"
                        }`}
                      >
                        <div className="w-full h-16 bg-stone-100 flex items-center justify-center">
                          {img ? (
                            <img src={img} alt={s.name} className="w-full h-full object-cover" />
                          ) : (
                            <Sparkles className="w-5 h-5 text-stone-300" aria-hidden="true" />
                          )}
                        </div>
                        {selected && (
                          <span className="absolute top-1 right-1 bg-storm-600 text-white rounded-full p-0.5">
                            <Check className="w-3 h-3" aria-hidden="true" />
                          </span>
                        )}
                        <div className="absolute inset-x-0 bottom-0 bg-black/55 px-1.5 py-1 flex items-center justify-between gap-1">
                          <span className="text-white text-[10px] truncate">{s.name}</span>
                          {s.isDefault && (
                            <span className="text-[9px] font-medium px-1 rounded bg-storm-100 text-storm-700 shrink-0">Mặc định</span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
              <p className="text-[11px] text-stone-400 mt-1">
                {styleId ? "Bấm lại để bỏ chọn (dùng phong cách mặc định)." : "Chưa chọn — hệ thống dùng phong cách mặc định."}
              </p>
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-medium text-stone-600 mb-1" htmlFor="st-layout">
                  Kiểu bố cục
                </label>
                <select
                  id="st-layout"
                  value={panelLayout}
                  onChange={(e) => setPanelLayout(e.target.value)}
                  className="rounded-lg border border-stone-300 px-3 py-2 text-sm"
                >
                  {PANEL_LAYOUTS.map((l) => (
                    <option key={l.key} value={l.key}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-600 mb-1" htmlFor="st-bg">
                  Nền ảnh
                </label>
                <select
                  id="st-bg"
                  value={background}
                  onChange={(e) => setBackground(e.target.value)}
                  className="rounded-lg border border-stone-300 px-3 py-2 text-sm"
                  title="Nền trắng / tối giản giúp ảnh sạch hơn (bớt chi tiết thừa gây rối)"
                >
                  {BACKGROUND_OPTIONS.map((b) => (
                    <option key={b.key} value={b.key}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-600 mb-1" htmlFor="st-ratio">
                  Tỉ lệ khung
                </label>
                <select
                  id="st-ratio"
                  value={aspectRatio}
                  onChange={(e) => setAspectRatio(e.target.value)}
                  className="rounded-lg border border-stone-300 px-3 py-2 text-sm"
                >
                  {ASPECT_RATIO_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-1.5 text-sm text-stone-600 pb-2.5">
                <input type="checkbox" checked={isShared} onChange={(e) => setIsShared(e.target.checked)} className="accent-storm-600" />
                Chia sẻ cả nhóm (bỏ chọn = chỉ mình tôi)
              </label>
            </div>

            {/* RAG — học từ ảnh đã thích (❤️) để prompt hợp gu hơn */}
            <label
              className={`flex items-start gap-2 text-sm rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${
                useRag ? "border-storm-300 bg-storm-50" : "border-stone-200 bg-white hover:border-stone-300"
              }`}
            >
              <input type="checkbox" checked={useRag} onChange={(e) => setUseRag(e.target.checked)} className="accent-storm-600 mt-0.5" />
              <span>
                <span className="flex items-center gap-1.5 font-medium text-stone-700">
                  <Brain className="w-4 h-4 text-storm-600" aria-hidden="true" /> Học theo ảnh tôi đã thích (RAG)
                </span>
                <span className="block text-[11px] text-stone-500 mt-0.5">
                  Khi bật, AI đọc thêm "gu" từ các ảnh bạn đã thả tim (bố cục, phong cách, kiểu hài) để vẽ hợp ý hơn. Quản lý ở Thư viện → tab RAG.
                </span>
              </span>
            </label>

            <button
              onClick={handleGenerate}
              disabled={generating}
              className="self-start flex items-center gap-1.5 text-sm font-medium text-white bg-storm-600 hover:bg-storm-700 px-4 py-2.5 rounded-lg disabled:opacity-60"
            >
              {generating ? (
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              ) : (
                <ImagePlus className="w-4 h-4" aria-hidden="true" />
              )}
              Tạo ảnh
            </button>

            {generating && <GenerationProgress />}
          </div>
        </div>
      )}

      {post && (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 text-sm font-medium text-stone-600 bg-stone-100 hover:bg-stone-200 px-3 py-2 rounded-lg"
          >
            <Plus className="w-4 h-4" aria-hidden="true" /> Tạo ảnh mới
          </button>
          <button
            onClick={handleRegenerate}
            disabled={regenerating}
            className="flex items-center gap-1.5 text-sm font-medium text-storm-700 bg-storm-50 hover:bg-storm-100 px-3 py-2 rounded-lg disabled:opacity-60"
            title="Vẽ lại 2 biến thể ảnh mới (giữ nguyên mô tả/nhân vật/tham chiếu), ảnh cũ sẽ bị xoá."
          >
            {regenerating ? (
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="w-4 h-4" aria-hidden="true" />
            )}
            Vẽ lại 2 biến thể
          </button>
        </div>
      )}

      {warning && (
        <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>{warning}</span>
        </div>
      )}
      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      {post && !post.selectedImageUrl && (
        <div className="grid grid-cols-2 gap-3 max-w-xl">
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
        <div className="flex flex-col gap-3 max-w-xl">
          <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" /> Ảnh tự động lưu trong Thư viện — chỉnh tiếp bao nhiêu lần cũng được.
          </div>

          {/* Vòng chỉnh sửa bằng câu lệnh (như ChatGPT) */}
          <div className="bg-white border border-stone-200 rounded-xl p-4 flex flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-stone-800 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-storm-600" aria-hidden="true" /> Chỉnh sửa bằng câu lệnh
                </p>
                <p className="text-xs text-stone-500 mt-0.5">
                  Gõ điều muốn đổi trên ảnh hiện tại — Gemini chỉnh, giữ nguyên phần còn lại. Có thể nhắc tên nhân vật (AI biết ai là ai trong khung).
                </p>
              </div>
              <button
                onClick={handleToggleFavorite}
                disabled={favoriting}
                title={favorited ? "Bỏ thích — gỡ khỏi thư viện RAG" : "Thả tim — lưu prompt & thông số vào thư viện RAG để học gu"}
                aria-pressed={favorited}
                className={`shrink-0 flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg border transition-colors ${
                  favorited ? "bg-rose-50 border-rose-200 text-rose-600" : "bg-white border-stone-200 text-stone-500 hover:border-rose-200 hover:text-rose-500"
                }`}
              >
                {favoriting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Heart className={`w-3.5 h-3.5 ${favorited ? "fill-rose-500 text-rose-500" : ""}`} aria-hidden="true" />
                )}
                {favorited ? "Đã thích" : "Thích"}
              </button>
            </div>

            {/* Panel context: prompt trước + nhân vật + style của ảnh đang sửa. Gemini
                cũng nhận lại các nhân vật này + bối cảnh gốc khi chỉnh tiếp. */}
            <EditContextPanel post={post} characters={characters} />

            <img
              src={imageDisplayUrl(post.selectedImageUrl) || undefined}
              alt="Ảnh hiện tại"
              className="w-full max-w-sm rounded-xl border border-stone-200"
              style={{ aspectRatio: (post.overlayJson?.aspectRatio || "1:1").replace(":", " / ") }}
            />
            <div className="flex items-start gap-2">
              <textarea
                rows={2}
                value={editInstruction}
                onChange={(e) => setEditInstruction(e.target.value)}
                disabled={editing}
                placeholder="VD: Grok đang quỳ lạy (không đứng), nền trắng, bỏ 2 nhân vật không xác định ở góc..."
                className="flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm disabled:opacity-60"
              />
              <button
                onClick={handleEditImage}
                disabled={editing || !editInstruction.trim()}
                className="shrink-0 flex items-center gap-1.5 text-sm font-medium text-white bg-storm-600 hover:bg-storm-700 px-3 py-2 rounded-lg disabled:opacity-60"
              >
                {editing ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Sparkles className="w-4 h-4" aria-hidden="true" />}
                Chỉnh
              </button>
            </div>
            {editing && (
              <p className="text-[11px] text-storm-600 flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Gemini đang chỉnh ảnh (thường 15–40 giây)...
              </p>
            )}
          </div>

          {/* Lịch sử ảnh — biến thể gốc + từng bước chỉnh; bấm để quay lại */}
          {(() => {
            const items = [
              ...post.imageVariants.map((v, i) => ({ label: `Biến thể ${i + 1}`, url: v.url })),
              ...(Array.isArray(post.overlayJson?.editHistory) ? post.overlayJson.editHistory : []).map(
                (h, i) => ({ label: `Chỉnh ${i + 1}: ${h.instruction}`, url: h.url })
              ),
            ];
            if (items.length <= 1) return null;
            return (
              <div className="bg-white border border-stone-200 rounded-xl p-3">
                <p className="text-xs font-medium text-stone-600 mb-2">Lịch sử ảnh — bấm để quay lại một bản trước</p>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {items.map((it, i) => {
                    const current = it.url === post.selectedImageUrl;
                    return (
                      <button
                        key={i}
                        onClick={() => !current && handleRevert(it.url)}
                        disabled={reverting || current}
                        title={it.label}
                        className={`shrink-0 w-20 rounded-lg overflow-hidden border-2 ${current ? "border-storm-500" : "border-transparent hover:border-storm-300"}`}
                      >
                        <img src={imageDisplayUrl(it.url) || undefined} alt={it.label} className="w-20 h-20 object-cover bg-stone-100" />
                        <span className="block text-[9px] text-stone-500 px-1 py-0.5 truncate">{current ? "Hiện tại" : it.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* Minh bạch: prompt JSON đã gửi Gemini + nhân vật đã dùng */}
          {post.overlayJson?.promptDebug && (
            <div className="bg-white border border-stone-200 rounded-xl p-3">
              <button
                onClick={() => setShowPrompt((v) => !v)}
                className="flex items-center gap-1 text-xs font-medium text-stone-500 hover:text-stone-700"
              >
                {showPrompt ? <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" /> : <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />}
                Xem prompt đã gửi Gemini + nhân vật đã dùng
              </button>
              {showPrompt && (
                <div className="mt-2 flex flex-col gap-2">
                  <p className="text-xs text-stone-600">
                    <span className="font-medium">Nhân vật đã dùng:</span>{" "}
                    {post.overlayJson.promptDebug.characters?.length ? post.overlayJson.promptDebug.characters.join(", ") : "(không có ảnh nhân vật)"}
                  </p>
                  <pre className="text-[10px] leading-snug text-stone-500 bg-stone-50 rounded-lg p-2 overflow-auto max-h-72 whitespace-pre-wrap">
                    {post.overlayJson.promptDebug.prompt}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* Bước riêng: gắn chữ & watermark (tuỳ chọn) */}
          <div className="bg-white border border-stone-200 rounded-xl p-3">
            <button
              onClick={() => setShowFinish((v) => !v)}
              className="flex items-center gap-1.5 text-sm font-medium text-stone-700"
            >
              {showFinish ? <ChevronUp className="w-4 h-4" aria-hidden="true" /> : <ChevronDown className="w-4 h-4" aria-hidden="true" />}
              Gắn chữ &amp; watermark (tuỳ chọn)
            </button>
            {showFinish && (
              <div className="mt-3">
                <TextOverlayEditor
                  imageUrl={imageDisplayUrl(post.selectedImageUrl) || post.selectedImageUrl}
                  initialOverlay={post.overlayJson}
                  watermarkOptions={WATERMARK_OPTIONS}
                  onExport={handleExport}
                  exporting={exporting}
                  aspectRatio={post.overlayJson?.aspectRatio || "1:1"}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {scenarios && (
        <ScenarioPickerModal
          scenarios={scenarios}
          onPick={applyScenario}
          onClose={() => setScenarios(null)}
        />
      )}
    </div>
  );
}

// Panel context của ảnh đang chỉnh: mô tả (prompt) trước + nhân vật đã dùng (kèm
// ảnh) + phong cách + cờ RAG. Cho người dùng thấy rõ khung này gồm những gì, và
// nhắc rằng Gemini cũng nhận lại đúng các nhân vật + bối cảnh này khi chỉnh tiếp.
function EditContextPanel({ post, characters }: { post: PostRow; characters: CharacterRow[] }) {
  const debug = post.overlayJson?.promptDebug;
  const styleName = debug?.style || null;
  const ragUsed = debug?.ragUsed || 0;
  const scene = post.promptText || "";
  // Danh sách nhân vật hiển thị, ưu tiên nhiều nguồn để LUÔN có thông tin:
  //  1) promptDebug.characters (mọi nhân vật đã chọn — bài mới).
  //  2) fallback: studioParams.characterIds → tên (bài cũ chưa lưu characters).
  const refBacked = new Set(debug?.charactersRef || []);
  let charRows: { name: string; row: CharacterRow | null; hasRef: boolean }[] = [];
  const names = debug?.characters || [];
  if (names.length) {
    charRows = names.map((name) => {
      const row = characters.find((c) => c.name === name) || null;
      return { name, row, hasRef: refBacked.size ? refBacked.has(name) : !!row?.referenceImageUrl };
    });
  } else {
    const ids = post.overlayJson?.studioParams?.characterIds || [];
    charRows = ids
      .map((id) => characters.find((c) => c.id === id))
      .filter((c): c is CharacterRow => !!c)
      .map((c) => ({ name: c.name, row: c, hasRef: !!c.referenceImageUrl }));
  }

  if (!scene && !charRows.length && !styleName) return null;

  return (
    <div className="bg-stone-50 border border-stone-200 rounded-lg p-3 flex flex-col gap-2.5">
      <p className="text-[11px] font-semibold text-stone-500 uppercase tracking-wide">Ảnh này gồm những gì (Gemini nhớ khi chỉnh tiếp)</p>

      {scene && (
        <div>
          <p className="text-[11px] font-medium text-stone-500 mb-0.5">Mô tả đã dùng</p>
          <p className="text-xs text-stone-700 leading-snug line-clamp-3">{scene}</p>
        </div>
      )}

      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-stone-500 mb-1">Nhân vật trong khung</p>
          {charRows.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {charRows.map(({ name, row, hasRef }) => (
                <span
                  key={name}
                  title={hasRef ? "Có ảnh tham chiếu — giữ đúng nét" : "Chưa có ảnh tham chiếu — AI vẽ theo mô tả"}
                  className="flex items-center gap-1 text-[11px] bg-white border border-stone-200 text-stone-700 px-1.5 py-1 rounded-lg"
                >
                  <span className="w-4 h-4 rounded-full overflow-hidden bg-stone-100 shrink-0 flex items-center justify-center">
                    {row?.referenceImageUrl ? (
                      <img src={imageDisplayUrl(row.referenceImageUrl) || undefined} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <UserRound className="w-2.5 h-2.5 text-stone-300" aria-hidden="true" />
                    )}
                  </span>
                  {name}
                  {!hasRef && <span className="text-[9px] text-amber-600">(chưa có ref)</span>}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-stone-400">Không gắn nhân vật từ thư viện — AI vẽ theo mô tả.</p>
          )}
        </div>

        {styleName && (
          <div>
            <p className="text-[11px] font-medium text-stone-500 mb-1">Phong cách</p>
            <span className="inline-flex items-center gap-1 text-[11px] bg-white border border-stone-200 text-stone-700 px-2 py-1 rounded-lg">
              <Sparkles className="w-3 h-3 text-storm-500" aria-hidden="true" /> {styleName}
            </span>
          </div>
        )}
      </div>

      {ragUsed > 0 && (
        <p className="text-[11px] text-storm-600 flex items-center gap-1">
          <Brain className="w-3.5 h-3.5" aria-hidden="true" /> Đã tham khảo {ragUsed} ảnh bạn từng thích (RAG) khi vẽ.
        </p>
      )}
    </div>
  );
}

// Tiến trình khi tạo ảnh — hệ thống làm nhiều bước server-side trong 1 lượt
// (dựng prompt JSON → dịch mô tả → Gemini vẽ 2 biến thể → lưu). Panel này báo
// bước đang chạy + thời gian trôi qua để người dùng biết hệ thống đang làm gì
// (không phải treo). Bước cuối quay cho tới khi có kết quả.
function GenerationProgress() {
  const [elapsed, setElapsed] = useState(0);
  const [step, setStep] = useState(0);
  const STEPS = [
    "Dựng kịch bản (bối cảnh + nhân vật + lời thoại → prompt) và gom ảnh tham chiếu",
    "Gemini vẽ 2 biến thể ảnh (thường mất 15–40 giây)",
  ];
  useEffect(() => {
    const t0 = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    const toStep2 = setTimeout(() => setStep(1), 3000);
    return () => {
      clearInterval(timer);
      clearTimeout(toStep2);
    };
  }, []);
  return (
    <div className="mt-3 bg-storm-50 border border-storm-200 rounded-lg p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs font-medium text-storm-800">
        <span>Đang tạo ảnh...</span>
        <span className="text-storm-500 tabular-nums">{elapsed}s</span>
      </div>
      {STEPS.map((label, i) => {
        const done = i < step;
        const active = i === step;
        return (
          <div key={i} className="flex items-start gap-2 text-xs">
            {done ? (
              <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0 mt-px" aria-hidden="true" />
            ) : active ? (
              <Loader2 className="w-4 h-4 text-storm-600 shrink-0 mt-px animate-spin" aria-hidden="true" />
            ) : (
              <span className="w-4 h-4 rounded-full border border-stone-300 shrink-0 mt-px" aria-hidden="true" />
            )}
            <span className={done ? "text-stone-400 line-through" : active ? "text-stone-700" : "text-stone-400"}>{label}</span>
          </div>
        );
      })}
    </div>
  );
}

// Modal chọn 1 trong 3 kịch bản hài AI vừa viết → điền vào form Studio.
function ScenarioPickerModal({
  scenarios,
  onPick,
  onClose,
}: {
  scenarios: ScenarioVariant[];
  onPick: (v: ScenarioVariant) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-stone-100 sticky top-0 bg-white">
          <h3 className="font-semibold text-stone-800 font-display">AI gợi ý kịch bản — chọn 1 phương án</h3>
          <button onClick={onClose} className="p-1.5 text-stone-400 hover:bg-stone-100 rounded-full" aria-label="Đóng">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        <div className="p-5 flex flex-col gap-3">
          {scenarios.length === 0 && (
            <p className="text-sm text-stone-400">AI chưa gợi ý được kịch bản nào. Thử mô tả ý tưởng rõ hơn.</p>
          )}
          {scenarios.map((v, i) => (
            <div key={i} className="border border-stone-200 rounded-xl p-4 flex flex-col gap-2 hover:border-storm-300 transition-colors">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-stone-800">{v.title}</h4>
                <span className="text-[11px] text-stone-400 shrink-0">{v.panelLayout === "2" ? "2 khung" : "1 khung"}</span>
              </div>
              <p className="text-sm text-stone-600">{v.scene}</p>
              {v.characters.length > 0 && (
                <p className="text-xs text-stone-500">
                  <span className="font-medium">Nhân vật:</span> {v.characters.join(", ")}
                </p>
              )}
              {v.dialogue.length > 0 && (
                <div className="flex flex-col gap-0.5 bg-stone-50 rounded-lg p-2.5">
                  {v.dialogue.map((d, j) => (
                    <p key={j} className="text-xs text-stone-600">
                      <span className="font-medium text-storm-700">{d.character}:</span> "{d.text}"
                    </p>
                  ))}
                </div>
              )}
              <button
                onClick={() => onPick(v)}
                className="self-start mt-1 flex items-center gap-1.5 text-sm font-medium text-white bg-storm-600 hover:bg-storm-700 px-3 py-1.5 rounded-lg"
              >
                <Check className="w-4 h-4" aria-hidden="true" /> Dùng phương án này
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
