import { useEffect, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { Loader2, Sparkles, Check, AlertTriangle, Send, RefreshCw } from "lucide-react";
import { generateImages, regenerateImages, getPost, selectImage, saveOverlay, submitForApproval } from "../services/posts";
import { imageDisplayUrl } from "../services/http";
import type { PostRow } from "../types";
import TextOverlayEditor from "../components/TextOverlayEditor";

const WATERMARK_OPTIONS = ["MATBAO", "MATBAO INVOICE"];

// B2.2 — tỉ lệ khung chọn trước khi sinh ảnh (khớp whitelist server).
const ASPECT_RATIO_OPTIONS: { value: string; label: string }[] = [
  { value: "1:1", label: "1:1 (vuông)" },
  { value: "3:4", label: "3:4 (dọc)" },
  { value: "9:16", label: "9:16 (dọc cao)" },
];

// VẼ (J3): sinh 2 biến thể ảnh KHÔNG chữ từ kịch bản đã chọn → chọn 1 ảnh →
// text-overlay editor (Canvas) → export ảnh cuối + watermark → gửi vào DUYỆT.
//
// Hai chế độ mở:
//   ?scriptId=<id> — luồng mới: sinh ảnh từ kịch bản đã chọn.
//   ?postId=<id>   — "Sửa thoại": mở lại bài đã có để chỉnh overlay/caption
//                    rồi export + gửi duyệt lại (KHÔNG tạo post mới).
export default function ImageStudio() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const scriptId = params.get("scriptId");
  const postId = params.get("postId");

  const [post, setPost] = useState<PostRow | null>(null);
  const [loadingPost, setLoadingPost] = useState(!!postId);
  const [generating, setGenerating] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [caption, setCaption] = useState("");
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState("1:1");

  // Chế độ "Sửa thoại" — nạp lại bài cũ theo postId.
  useEffect(() => {
    if (!postId) return;
    let alive = true;
    (async () => {
      try {
        const p = await getPost(postId);
        if (!alive) return;
        setPost(p);
        setCaption(p.caption || "");
      } catch (e: any) {
        if (alive) setError(e?.message || "Không tải được bài để sửa.");
      } finally {
        if (alive) setLoadingPost(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [postId]);

  if (!scriptId && !postId) {
    return (
      <div className="text-center py-16 text-stone-400 text-sm">
        Chưa chọn kịch bản. Quay lại{" "}
        <Link to="/scripts" className="text-storm-600 hover:underline">
          màn Kịch bản
        </Link>{" "}
        để chọn phương án trước.
      </div>
    );
  }

  async function handleGenerate() {
    if (!scriptId) return;
    setGenerating(true);
    setError(null);
    setWarning(null);
    try {
      const result: any = await generateImages(scriptId, aspectRatio);
      setPost(result);
      setCaption(result.caption || "");
      if (result.warning) setWarning(result.warning);
    } catch (e: any) {
      setError(e?.message || "Sinh ảnh thất bại.");
    } finally {
      setGenerating(false);
    }
  }

  // B2.4 — vẽ lại 2 biến thể ảnh (giữ nguyên aspectRatio/kịch bản đã dùng).
  async function handleRegenerate() {
    if (!post) return;
    setRegenerating(true);
    setError(null);
    setWarning(null);
    try {
      const result: any = await regenerateImages(post.id);
      setPost(result);
      if (result.warning) setWarning(result.warning);
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
      const updated = await selectImage(post.id, url);
      setPost(updated);
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
      const updated = await saveOverlay(post.id, overlay, finalImageDataUrl, caption);
      setPost(updated);
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

  const isReopen = !!postId;

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <div>
        <h1 className="text-lg font-bold text-stone-800 font-display">
          {isReopen ? "Sửa thoại (VẼ)" : "Dựng ảnh (VẼ)"}
        </h1>
        <p className="text-sm text-stone-500">
          {isReopen
            ? "Chỉnh nhãn chữ + watermark trên ảnh đã chọn → export lại → gửi duyệt lại."
            : "2 biến thể ảnh không chữ → chọn 1 → gắn nhãn + watermark."}
        </p>
      </div>

      {loadingPost && (
        <div className="flex items-center gap-2 text-stone-400 text-sm py-6">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Đang tải bài...
        </div>
      )}

      {!post && !loadingPost && scriptId && (
        <div className="flex flex-col gap-2 self-start">
          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1" htmlFor="aspect-ratio">
              Tỉ lệ khung
            </label>
            <select
              id="aspect-ratio"
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value)}
              className="rounded-lg border border-stone-300 px-3 py-2 text-sm"
            >
              {ASPECT_RATIO_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="self-start flex items-center gap-1.5 text-sm font-medium text-white bg-storm-600 hover:bg-storm-700 px-4 py-2.5 rounded-lg disabled:opacity-60"
          >
            {generating ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Sparkles className="w-4 h-4" aria-hidden="true" />}
            Sinh 2 biến thể ảnh
          </button>
        </div>
      )}

      {post && (
        <button
          onClick={handleRegenerate}
          disabled={regenerating}
          className="self-start flex items-center gap-1.5 text-sm font-medium text-storm-700 bg-storm-50 hover:bg-storm-100 px-3 py-2 rounded-lg disabled:opacity-60"
          title="Sinh lại 2 biến thể ảnh mới (giữ nguyên tỉ lệ khung + kịch bản), ảnh cũ sẽ bị xoá."
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

      {/* Chọn 1 trong 2 biến thể (chỉ khi chưa chọn ảnh) */}
      {post && !post.selectedImageUrl && (
        <div className="grid grid-cols-2 gap-3">
          {post.imageVariants.map((v, i) => (
            <button
              key={i}
              onClick={() => handleSelectImage(v.url)}
              disabled={selecting}
              className={`relative rounded-xl overflow-hidden border-2 transition-colors ${
                post.selectedImageUrl === v.url ? "border-storm-500" : "border-transparent hover:border-storm-200"
              }`}
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

      {/* Editor overlay — luôn hiện khi đã có ảnh chọn (cho phép re-edit khi Sửa thoại) */}
      {post && post.selectedImageUrl && (
        <div className="flex flex-col gap-3">
          <div>
            <label className="block text-xs font-medium text-stone-600 mb-1" htmlFor="caption">
              Caption (≤ 2 câu, không giải thích trò đùa)
            </label>
            <textarea
              id="caption"
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
              <p className="text-xs font-medium text-stone-500">Ảnh cuối đã lưu:</p>
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
                Gửi duyệt (vào kanban Chờ duyệt)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
