import { useEffect, useState } from "react";
import { Loader2, ImagePlus, Check, Download, Pencil, Wand2, X } from "lucide-react";
import { generateRemakeImage, selectRemakeImage, editRemakeImage, proposeRemakeConcepts } from "../services/remakes";
import type { RemakeImage, ImageConcept } from "../types";
import { imageDisplayUrl } from "../services/http";
import ImageRegionEditor from "./ImageRegionEditor";
import ImageSpecEditor, { ResetSpecButton, type ImageSpec } from "./ImageSpecEditor";

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
  concepts = [],
  autoDrawing = false,
  autoDrawError = null,
  onChanged,
}: {
  remakeId: string;
  images: RemakeImage[];
  selectedUrl?: string | null;
  hasDraft: boolean;
  /** Ba phương án ảnh AI đã đề xuất. */
  concepts?: ImageConcept[];
  /** Hệ thống đang tự đề xuất + vẽ ngay sau khi viết xong. */
  autoDrawing?: boolean;
  /** Lý do tự vẽ thất bại (nếu có). */
  autoDrawError?: string | null;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [drawingConcept, setDrawingConcept] = useState<number | null>(null);
  const [proposing, setProposing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ratio, setRatio] = useState("1:1");
  const [prompt, setPrompt] = useState("");
  const [showPrompt, setShowPrompt] = useState(false);
  const [lastDescription, setLastDescription] = useState<string | null>(null);
  const [charsUsed, setCharsUsed] = useState<
    { id: string; name: string; hasReference: boolean; missingReason?: string }[]
  >([]);
  const [sourceInfo, setSourceInfo] = useState<{ attached: boolean; reason?: string } | null>(null);
  // Đặc tả của lần vẽ gần nhất: xem được, sửa được, vẽ lại đúng theo bản đã sửa.
  const [spec, setSpec] = useState<ImageSpec | null>(null);
  const [specEdited, setSpecEdited] = useState(false);
  const [showSpec, setShowSpec] = useState(false);
  // Prompt đúng như đã gửi — câu hỏi đầu tiên khi ảnh ra sai luôn là "nó đã
  // nhận lệnh gì", và suy lại từ đặc tả không bao giờ chắc bằng đọc thứ đã gửi.
  const [promptSent, setPromptSent] = useState<string | null>(null);

  // Mở bài cũ ra cũng phải xem được đặc tả và prompt của ảnh đang chọn — không
  // bắt vẽ lại một lần nữa chỉ để biết lần trước đã gửi gì.
  const current = images.find((i) => i.url === selectedUrl) || images[images.length - 1];
  useEffect(() => {
    if (specEdited) return; // đang sửa dở thì đừng ghi đè
    setSpec(((current as any)?.specJson as ImageSpec) || null);
    setPromptSent(((current as any)?.promptSent as string) || null);
  }, [current?.url, specEdited]);
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

  async function handleGenerate(conceptIndex?: number) {
    setBusy(true);
    setDrawingConcept(conceptIndex ?? null);
    setError(null);
    try {
      const out = await generateRemakeImage(remakeId, {
        aspectRatio: ratio,
        prompt: prompt.trim() || undefined,
        // Chọn phương án nào thì vẽ phương án đó; đã sửa đặc tả thì theo bản sửa.
        conceptIndex: specEdited ? undefined : conceptIndex,
        spec: specEdited && spec ? spec : undefined,
      });
      setLastDescription(out.description);
      setCharsUsed(out.charactersUsed || []);
      setSourceInfo({ attached: !!out.sourceAttached, reason: out.sourceMissingReason });
      if (out.spec) {
        setSpec(out.spec as ImageSpec);
        setSpecEdited(false);
      }
      setPromptSent(((out.image as any)?.promptSent as string) || null);
      onChanged();
    } catch (e: any) {
      setError(e?.message || "Không vẽ được ảnh.");
    } finally {
      setBusy(false);
      setDrawingConcept(null);
    }
  }

  // Ba phương án nào CHƯA vẽ ảnh nào — để đánh dấu cái đã vẽ, cái còn chờ.
  const drawnConcepts = new Set(
    images.map((i) => (i as any).conceptIndex).filter((x: any) => Number.isInteger(x)),
  );

  async function handleReproposeConcepts() {
    setProposing(true);
    setError(null);
    try {
      await proposeRemakeConcepts(remakeId);
      onChanged();
    } catch (e: any) {
      setError(e?.message || "Không đề xuất được phương án ảnh.");
    } finally {
      setProposing(false);
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
            {/* Đang tự vẽ ngay sau khi viết xong — không cần bấm gì. */}
            {autoDrawing && (
              <div role="status" className="ds-alert ds-alert-info mt-3">
                <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden="true" />
                <span>
                  Đang đề xuất 3 phương án ảnh và vẽ phương án đầu — không cần bấm gì, ảnh sẽ tự hiện ra ở đây
                  (thường 30-60 giây).
                </span>
              </div>
            )}

            {autoDrawError && !autoDrawing && images.length === 0 && (
              <div role="alert" className="ds-alert ds-alert-warning mt-3">
                <span>
                  Bài viết đã xong nhưng tự vẽ ảnh không được: {autoDrawError}{" "}
                  {/* Nói đúng việc làm được: không có phương án nào thì bảo "chọn
                      phương án bên dưới" là chỉ vào chỗ trống. */}
                  {concepts.length > 0 ? "Chọn một phương án bên dưới để vẽ." : 'Bấm "Vẽ ảnh" để thử lại.'}
                </span>
              </div>
            )}

            {/* Ba phương án AI đề xuất. Phương án đầu được vẽ tự động; hai cái
                còn lại nằm sẵn, đổi sang chỉ một cú bấm — không phải bấm "vẽ
                lại" rồi cầu may. */}
            {concepts.length > 0 && (
              <div className="mt-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-stone-700">Phương án ảnh AI đề xuất</p>
                  <button
                    type="button"
                    onClick={handleReproposeConcepts}
                    disabled={proposing || busy || autoDrawing}
                    className="ds-btn ds-btn-ghost ds-btn-sm"
                    title="Không ưng cả ba? Đề xuất ba phương án khác — chỉ là việc chữ, chưa vẽ nên không tốn tiền vẽ."
                  >
                    {proposing ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Wand2 className="w-3.5 h-3.5" aria-hidden="true" />}
                    Đề xuất 3 phương án khác
                  </button>
                </div>
                <ul className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-2">
                  {concepts.map((c, i) => {
                    const drawn = drawnConcepts.has(i);
                    const thisBusy = busy && drawingConcept === i;
                    return (
                      <li
                        key={i}
                        className={`border rounded-xl p-3 flex flex-col gap-1.5 ${
                          drawn ? "border-storm-300 bg-storm-50/40" : "border-stone-200"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-semibold text-stone-800">
                            {i + 1}. {c.title}
                          </p>
                          <span className="text-[10px] text-stone-400 shrink-0">{c.layout}</span>
                        </div>
                        {c.why && <p className="text-xs text-stone-500">{c.why}</p>}
                        {c.panels.some((p) => p.dialogue) && (
                          <p className="text-[11px] text-stone-600 italic line-clamp-2">
                            "{c.panels.map((p) => p.dialogue).filter(Boolean).join(" / ")}"
                          </p>
                        )}
                        <button
                          type="button"
                          onClick={() => handleGenerate(i)}
                          disabled={busy || autoDrawing}
                          className={`ds-btn ds-btn-sm mt-auto ${drawn ? "ds-btn-ghost" : "ds-btn-primary"}`}
                        >
                          {thisBusy ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                          ) : (
                            <ImagePlus className="w-3.5 h-3.5" aria-hidden="true" />
                          )}
                          {thisBusy ? "Đang vẽ..." : drawn ? "Vẽ lại phương án này" : "Vẽ phương án này"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

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

              {/* Nút vẽ chung chỉ còn cần khi tự tả hoặc đã sửa đặc tả — đường
                  chính là bấm thẳng vào một trong ba phương án bên dưới. */}
              {(showPrompt || specEdited || concepts.length === 0) && (
                <button
                  type="button"
                  onClick={() => handleGenerate()}
                  disabled={busy || autoDrawing}
                  className="ds-btn ds-btn-primary"
                >
                  {busy && drawingConcept === null ? (
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <ImagePlus className="w-4 h-4" aria-hidden="true" />
                  )}
                  {specEdited ? "Vẽ theo đặc tả đã sửa" : showPrompt ? "Vẽ theo lời tả của tôi" : "Vẽ ảnh"}
                </button>
              )}

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

            {/* Nói rõ đã đính ảnh nào. Trước đây thiếu ảnh mẫu là im lặng — model
                vẽ theo chữ, ra nhân vật "na ná", và không ai biết vì sao. */}
            {(charsUsed.length > 0 || sourceInfo) && (
              <div className="text-xs text-stone-500 mt-2 flex flex-col gap-0.5">
                {charsUsed.length > 0 && (
                  <p>
                    Ảnh mẫu đã đính:{" "}
                    {charsUsed.map((c, i) => (
                      <span key={c.id}>
                        {i > 0 && ", "}
                        {c.hasReference ? (
                          <span className="text-stone-700">{c.name} ✓</span>
                        ) : (
                          <span className="text-amber-700">
                            {c.name} — THIẾU ({c.missingReason || "không đọc được ảnh"})
                          </span>
                        )}
                      </span>
                    ))}
                  </p>
                )}
                {sourceInfo && (
                  <p className={sourceInfo.attached ? "" : "text-amber-700"}>
                    Ảnh gốc làm mẫu bố cục:{" "}
                    {sourceInfo.attached ? "đã đính ✓" : `không đính được (${sourceInfo.reason || "bài không có ảnh"})`}
                  </p>
                )}
              </div>
            )}

            {/* Bản đặc tả: mặc định gập lại vì phần lớn lần vẽ không cần đụng tới.
                Cần chỉnh chính xác thì mở ra — sửa đúng mục, không phải tả lại
                cả cảnh bằng lời rồi hy vọng model giữ nguyên phần còn lại. */}
            {spec && (
              <div className="mt-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setShowSpec((v) => !v)}
                    className="ds-btn ds-btn-ghost ds-btn-sm"
                  >
                    {showSpec ? "Ẩn bản đặc tả" : "Xem & sửa bản đặc tả"}
                  </button>
                  {promptSent && (
                    <details className="w-full mt-1">
                      <summary className="text-[11px] text-stone-500 cursor-pointer hover:text-stone-700">
                        Xem đúng prompt đã gửi cho công cụ vẽ
                      </summary>
                      <pre className="text-[10px] text-stone-600 bg-stone-50 border border-stone-200 rounded-lg p-2 mt-1 overflow-x-auto whitespace-pre-wrap max-h-72">
                        {promptSent}
                      </pre>
                    </details>
                  )}
                  {specEdited && (
                    <>
                      <span className="text-[11px] text-amber-700">
                        Đã sửa — bấm "Vẽ thêm phương án" để vẽ theo bản này.
                      </span>
                      <ResetSpecButton
                        disabled={busy}
                        onReset={() => {
                          setSpecEdited(false);
                          setShowSpec(false);
                        }}
                      />
                    </>
                  )}
                </div>
                {showSpec && (
                  <div className="mt-2">
                    <ImageSpecEditor
                      spec={spec}
                      disabled={busy}
                      onChange={(next) => {
                        setSpec(next);
                        setSpecEdited(true);
                      }}
                    />
                  </div>
                )}
              </div>
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
