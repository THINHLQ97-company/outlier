import { useState } from "react";
import { Loader2, ImagePlus, Check, Download, Pencil, Wand2, X } from "lucide-react";
import { generateRemakeImage, selectRemakeImage, editRemakeImage } from "../services/remakes";
import type { RemakeImage } from "../types";
import { imageDisplayUrl } from "../services/http";
import ImageRegionEditor from "./ImageRegionEditor";

// Ảnh cho bản viết. Khác luồng "Sáng tạo" (vẽ meme theo dàn nhân vật cố định):
// ở đây ảnh bám nhận diện của thương hiệu người dùng.
//
// Giữ nhiều phương án thay vì một ảnh: lần vẽ đầu hiếm khi trúng, và người dùng
// cần so sánh rồi chọn. Prompt của từng ảnh được giữ lại vì hay phải sửa một
// chi tiết nhỏ rồi vẽ lại.

const RATIOS = [
  { value: "1:1", label: "Vuông 1:1" },
  { value: "4:5", label: "Dọc 4:5" },
  { value: "16:9", label: "Ngang 16:9" },
  { value: "9:16", label: "Story 9:16" },
];

export default function RemakeImages({
  remakeId,
  images,
  selectedUrl,
  hasDraft,
  onChanged,
}: {
  remakeId: string;
  images: RemakeImage[];
  selectedUrl?: string | null;
  hasDraft: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ratio, setRatio] = useState("1:1");
  const [prompt, setPrompt] = useState("");
  const [showPrompt, setShowPrompt] = useState(false);
  const [lastDescription, setLastDescription] = useState<string | null>(null);
  const [charsUsed, setCharsUsed] = useState<{ id: string; name: string; hasReference: boolean }[]>([]);
  // Chỉnh ảnh: mở đúng một ảnh mỗi lần, để khỏi lẫn đang sửa cái nào.
  const [editing, setEditing] = useState<RemakeImage | null>(null);
  const [editBusy, setEditBusy] = useState(false);

  async function handleEdit(instruction: string, mask: string | null) {
    if (!editing) return;
    setEditBusy(true);
    setError(null);
    try {
      await editRemakeImage(remakeId, { instruction, imageUrl: editing.url, mask });
      setEditing(null);
      onChanged();
    } catch (e: any) {
      setError(e?.message || "Không chỉnh được ảnh.");
    } finally {
      setEditBusy(false);
    }
  }

  async function handleGenerate() {
    setBusy(true);
    setError(null);
    try {
      const out = await generateRemakeImage(remakeId, {
        aspectRatio: ratio,
        prompt: prompt.trim() || undefined,
      });
      setLastDescription(out.description);
      setCharsUsed(out.charactersUsed || []);
      onChanged();
    } catch (e: any) {
      setError(e?.message || "Không vẽ được ảnh.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSelect(url: string) {
    try {
      await selectRemakeImage(remakeId, url);
      onChanged();
    } catch (e: any) {
      setError(e?.message || "Không chọn được ảnh.");
    }
  }

  return (
    <div className="ds-card">
      <div className="ds-card-body">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <h3 className="font-bold text-stone-800">Ảnh cho bài này</h3>
          <p className="text-xs text-stone-400">
            Vẽ theo nhận diện hình ảnh của thương hiệu — khai ở mục Thương hiệu thì ảnh mới đúng trang.
          </p>
        </div>

        {!hasDraft ? (
          <div className="ds-empty mt-3">
            <p>Viết xong rồi mới vẽ được.</p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 mt-3 flex-wrap">
              <label htmlFor={`ratio-${remakeId}`} className="sr-only">
                Tỉ lệ khung ảnh
              </label>
              <select
                id={`ratio-${remakeId}`}
                className="ds-input w-auto"
                value={ratio}
                onChange={(e) => setRatio(e.target.value)}
              >
                {RATIOS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>

              <button type="button" onClick={handleGenerate} disabled={busy} className="ds-btn ds-btn-primary">
                {busy ? (
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                ) : (
                  <ImagePlus className="w-4 h-4" aria-hidden="true" />
                )}
                {images.length > 0 ? "Vẽ thêm phương án" : "Vẽ ảnh"}
              </button>

              <button type="button"
                onClick={() => setShowPrompt((v) => !v)}
                className="ds-btn ds-btn-ghost ds-btn-sm"
                title="Tự tả ảnh thay vì để công cụ tự đọc bài rồi tả"
              >
                <Pencil className="w-3.5 h-3.5" aria-hidden="true" /> Tự tả ảnh
              </button>
            </div>

            {showPrompt && (
              <div className="mt-2">
                <label htmlFor={`prompt-${remakeId}`} className="block text-xs font-medium text-stone-600">
                  Tả ảnh cần vẽ
                </label>
                <textarea
                  id={`prompt-${remakeId}`}
                  className="ds-input w-full mt-1"
                  rows={3}
                  placeholder="Bỏ trống thì công cụ tự đọc bản viết rồi tả. Điền vào đây nếu bạn muốn tả theo ý mình."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />
              </div>
            )}

            {busy && (
              <p className="text-xs text-stone-400 mt-2">Đang vẽ, thường mất 10–30 giây…</p>
            )}

            {error && (
              <div role="alert" className="ds-alert ds-alert-danger mt-3">
                {error}
              </div>
            )}

            {charsUsed.length > 0 && (
              <p className="text-xs text-stone-500 mt-2">
                Vẽ theo nhân vật: {charsUsed.map((c) => c.name).join(", ")}
                {charsUsed.some((c) => !c.hasReference) && (
                  <span className="text-amber-600">
                    {" "}
                    — có nhân vật chưa có ảnh mẫu nên chỉ tả được bằng chữ, ngoại hình sẽ kém nhất quán.
                  </span>
                )}
              </p>
            )}

            {lastDescription && !prompt.trim() && (
              <details className="mt-3">
                <summary className="text-xs text-stone-500 cursor-pointer">
                  Xem mô tả mà công cụ đã dùng để vẽ
                </summary>
                <p className="text-xs text-stone-600 mt-1 whitespace-pre-wrap">{lastDescription}</p>
              </details>
            )}

            {images.length > 0 && (
              <ul className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-4">
                {images.map((img) => {
                  const isSelected = img.url === selectedUrl;
                  return (
                    <li
                      key={img.url}
                      className={`border rounded-xl overflow-hidden ${
                        isSelected ? "border-storm-500 ring-2 ring-storm-200" : "border-stone-200"
                      }`}
                    >
                      <img src={imageDisplayUrl(img.url) || undefined} alt={img.prompt.slice(0, 80)} className="w-full aspect-square object-cover bg-stone-100" loading="lazy" />
                      <div className="p-2">
                        {/* Mô tả đã dùng để vẽ — trước đây lưu mà không hiện ra bao giờ. */}
                        <details className="mb-1.5">
                          <summary className="text-[11px] text-stone-400 cursor-pointer hover:text-stone-600">
                            Xem mô tả đã dùng
                          </summary>
                          <p className="text-[11px] text-stone-500 mt-1 whitespace-pre-wrap">{img.prompt}</p>
                        </details>
                        <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-stone-400">{img.aspectRatio}</span>
                        <div className="flex items-center gap-1">
                          <a
                            href={imageDisplayUrl(img.url) || img.url}
                            download
                            className="text-xs text-stone-500 hover:text-stone-800 p-1"
                            title="Tải ảnh về"
                          >
                            <Download className="w-3.5 h-3.5" aria-hidden="true" />
                          </a>
                          {isSelected ? (
                            <span className="ds-badge ds-badge-success">
                              <Check className="w-3 h-3" aria-hidden="true" /> Đang chọn
                            </span>
                          ) : (
                            <button type="button" onClick={() => handleSelect(img.url)} className="ds-btn ds-btn-ghost ds-btn-sm">
                              Chọn
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setEditing(img)}
                            className="text-xs text-stone-500 hover:text-storm-700 p-1"
                            title="Chỉnh ảnh bằng lời, khoanh vùng được"
                            aria-label="Chỉnh ảnh"
                          >
                            <Wand2 className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {editing && (
              <div
                className="ds-modal-overlay open"
                onClick={() => !editBusy && setEditing(null)}
                role="dialog"
                aria-modal="true"
                aria-label="Chỉnh ảnh"
              >
                <div className="ds-modal !max-w-2xl" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-stone-200">
                    <h3 className="font-bold text-stone-800">Chỉnh ảnh</h3>
                    <button
                      type="button"
                      onClick={() => !editBusy && setEditing(null)}
                      className="ds-btn ds-btn-ghost ds-btn-sm"
                      aria-label="Đóng"
                    >
                      <X className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </div>
                  <div className="ds-modal-body max-h-[75vh] overflow-y-auto">
                    <p className="text-xs text-stone-500 mb-2">
                      Nói cần đổi gì, hoặc khoanh vùng trên ảnh rồi nói — chỉ vùng khoanh bị sửa, phần còn lại giữ nguyên.
                    </p>
                    <ImageRegionEditor
                      imageUrl={imageDisplayUrl(editing.url) || editing.url}
                      aspectRatio={editing.aspectRatio || "1:1"}
                      editing={editBusy}
                      onSubmit={handleEdit}
                    />
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
