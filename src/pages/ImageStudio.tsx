import { useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { Loader2, Sparkles, Check, AlertTriangle, Send } from "lucide-react";
import { generateImages, selectImage, saveOverlay, submitForApproval } from "../services/posts";
import type { PostRow } from "../types";
import TextOverlayEditor from "../components/TextOverlayEditor";

const WATERMARK_OPTIONS = ["MATBAO", "MATBAO INVOICE"];

// VẼ (J3): sinh 2 biến thể ảnh KHÔNG chữ từ kịch bản đã chọn → chọn 1 ảnh →
// text-overlay editor (Canvas) → export ảnh cuối + watermark → gửi vào DUYỆT.
export default function ImageStudio() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const scriptId = params.get("scriptId");

  const [post, setPost] = useState<PostRow | null>(null);
  const [generating, setGenerating] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [caption, setCaption] = useState("");
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!scriptId) {
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
    setGenerating(true);
    setError(null);
    setWarning(null);
    try {
      const result: any = await generateImages(scriptId!);
      setPost(result);
      setCaption(result.caption || "");
      if (result.warning) setWarning(result.warning);
    } catch (e: any) {
      setError(e?.message || "Sinh ảnh thất bại.");
    } finally {
      setGenerating(false);
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

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      <div>
        <h1 className="text-lg font-bold text-stone-800 font-display">Dựng ảnh (VẼ)</h1>
        <p className="text-sm text-stone-500">2 biến thể ảnh không chữ → chọn 1 → gắn nhãn + watermark.</p>
      </div>

      {!post && (
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="self-start flex items-center gap-1.5 text-sm font-medium text-white bg-storm-600 hover:bg-storm-700 px-4 py-2.5 rounded-lg disabled:opacity-60"
        >
          {generating ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Sparkles className="w-4 h-4" aria-hidden="true" />}
          Sinh 2 biến thể ảnh
        </button>
      )}

      {warning && (
        <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>{warning}</span>
        </div>
      )}
      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      {post && !post.finalImageUrl && (
        <>
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
                <img src={v.url} alt={`Biến thể ảnh ${i + 1}`} className="w-full aspect-square object-cover bg-stone-100" />
                {post.selectedImageUrl === v.url && (
                  <span className="absolute top-2 right-2 bg-storm-600 text-white rounded-full p-1">
                    <Check className="w-3.5 h-3.5" aria-hidden="true" />
                  </span>
                )}
              </button>
            ))}
          </div>

          {post.selectedImageUrl && (
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
                imageUrl={post.selectedImageUrl}
                initialOverlay={post.overlayJson}
                watermarkOptions={WATERMARK_OPTIONS}
                onExport={handleExport}
                exporting={exporting}
              />
            </div>
          )}
        </>
      )}

      {post?.finalImageUrl && (
        <div className="flex flex-col gap-3">
          <img src={post.finalImageUrl} alt="Ảnh cuối kèm watermark" className="w-full max-w-sm rounded-xl border border-stone-200" />
          <p className="text-sm text-stone-600 italic">"{caption}"</p>
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
  );
}
