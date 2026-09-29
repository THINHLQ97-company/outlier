import { useState } from "react";
import { Braces, List, RotateCcw, AlertTriangle } from "lucide-react";

// Bản đặc tả ảnh — thứ thật sự điều khiển việc vẽ.
//
// Prompt gửi cho công cụ vẽ là một khối JSON dài. Đưa nguyên khối đó cho người
// làm nội dung là bắt họ đọc dấu ngoặc nhọn để sửa một câu tiếng Việt. Nhưng
// giấu hẳn đi thì mất luôn khả năng chỉnh chính xác — tả lại cả cảnh bằng lời
// rồi hy vọng model giữ nguyên phần còn lại là cách làm may rủi.
//
// Nên: mặc định hiện TỪNG MỤC bằng tiếng Việt, sửa mục nào thì chỉ mục đó đổi.
// Ai muốn động thẳng vào JSON thì bật sang chế độ JSON — không ai bị ép.

export interface ImageSpec {
  role?: string;
  aspect_ratio?: string;
  scene?: string;
  characters?: { name: string; keep_appearance_from_reference_image?: string; note?: string }[];
  brand_visual?: { template?: string; palette?: string[]; must_have?: string[]; do_not?: string[] };
  text_in_image?: string | null;
  rules?: string[];
  [k: string]: any;
}

function listToText(v?: string[]): string {
  return (v || []).join("\n");
}
function textToList(v: string): string[] | undefined {
  const items = v
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
  return items.length ? items : undefined;
}

export default function ImageSpecEditor({
  spec,
  onChange,
  disabled,
}: {
  spec: ImageSpec;
  onChange: (next: ImageSpec) => void;
  disabled?: boolean;
}) {
  const [mode, setMode] = useState<"friendly" | "json">("friendly");
  const [jsonText, setJsonText] = useState(() => JSON.stringify(spec, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);

  function patch(part: Partial<ImageSpec>) {
    const next = { ...spec, ...part };
    onChange(next);
    setJsonText(JSON.stringify(next, null, 2));
  }

  function patchVisual(part: Partial<NonNullable<ImageSpec["brand_visual"]>>) {
    patch({ brand_visual: { ...(spec.brand_visual || {}), ...part } });
  }

  function applyJson(text: string) {
    setJsonText(text);
    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Phải là một đối tượng JSON.");
      }
      setJsonError(null);
      onChange(parsed);
    } catch (e: any) {
      // Không đẩy bản hỏng ra ngoài — giữ bản cuối còn đọc được, báo lỗi tại chỗ.
      setJsonError(e?.message || "JSON không đọc được.");
    }
  }

  return (
    <div className="border border-stone-200 rounded-xl">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-stone-200">
        <div>
          <p className="text-sm font-semibold text-stone-800">Bản đặc tả ảnh</p>
          <p className="text-[11px] text-stone-400">
            Đây là thứ điều khiển việc vẽ. Sửa mục nào thì chỉ mục đó đổi, phần còn lại giữ nguyên.
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setMode("friendly")}
            className={`ds-btn ds-btn-sm ${mode === "friendly" ? "ds-btn-secondary" : "ds-btn-ghost"}`}
            aria-pressed={mode === "friendly"}
          >
            <List className="w-3.5 h-3.5" aria-hidden="true" /> Theo mục
          </button>
          <button
            type="button"
            onClick={() => {
              setJsonText(JSON.stringify(spec, null, 2));
              setMode("json");
            }}
            className={`ds-btn ds-btn-sm ${mode === "json" ? "ds-btn-secondary" : "ds-btn-ghost"}`}
            aria-pressed={mode === "json"}
            title="Xem và sửa thẳng dạng JSON"
          >
            <Braces className="w-3.5 h-3.5" aria-hidden="true" /> JSON
          </button>
        </div>
      </div>

      {mode === "json" ? (
        <div className="p-3">
          <label className="sr-only" htmlFor="spec-json">
            Đặc tả dạng JSON
          </label>
          <textarea
            id="spec-json"
            rows={16}
            spellCheck={false}
            disabled={disabled}
            className="ds-input w-full font-mono text-[11px] leading-relaxed"
            value={jsonText}
            onChange={(e) => applyJson(e.target.value)}
          />
          {jsonError ? (
            <p className="text-[11px] text-red-600 mt-1 flex items-start gap-1">
              <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" aria-hidden="true" /> {jsonError} — bản hỏng chưa được
              áp dụng, sửa xong là nhận ngay.
            </p>
          ) : (
            <p className="text-[11px] text-stone-400 mt-1">Sửa xong là áp dụng ngay, không cần bấm gì thêm.</p>
          )}
        </div>
      ) : (
        <div className="p-3 flex flex-col gap-3">
          <div>
            <label className="ds-label" htmlFor="spec-scene">
              Cảnh cần vẽ
            </label>
            <textarea
              id="spec-scene"
              rows={3}
              disabled={disabled}
              className="ds-input w-full text-xs"
              value={spec.scene || ""}
              onChange={(e) => patch({ scene: e.target.value })}
              placeholder="Chuyện gì đang diễn ra trong ảnh: ai, làm gì, ở đâu, biểu cảm thế nào"
            />
          </div>

          <div>
            <label className="ds-label" htmlFor="spec-text">
              Chữ hiện trong ảnh <span className="font-normal text-stone-400">(bỏ trống = không vẽ chữ)</span>
            </label>
            <input
              id="spec-text"
              disabled={disabled}
              className="ds-input w-full text-xs"
              value={spec.text_in_image || ""}
              onChange={(e) => patch({ text_in_image: e.target.value || null })}
              placeholder="Câu chốt hoặc tiêu đề muốn hiện trên ảnh"
            />
          </div>

          {(spec.characters || []).length > 0 && (
            <div>
              <p className="ds-label mb-1">Nhân vật trong ảnh</p>
              <ul className="flex flex-col gap-1">
                {(spec.characters || []).map((c, i) => (
                  <li key={`${c.name}-${i}`} className="text-xs text-stone-600 border border-stone-200 rounded-lg px-2.5 py-1.5">
                    <span className="font-medium text-stone-800">{c.name}</span>
                    {c.keep_appearance_from_reference_image ? (
                      <span className="text-stone-400"> · vẽ theo ảnh mẫu {c.keep_appearance_from_reference_image}</span>
                    ) : (
                      <span className="text-amber-600"> · chưa có ảnh mẫu, chỉ tả bằng chữ nên dễ lệch</span>
                    )}
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-stone-400 mt-1">
                Đổi nhân vật ở mục Thương hiệu → trang → Nhân vật đại diện.
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="ds-label" htmlFor="spec-must">
                Bắt buộc có trong ảnh
              </label>
              <textarea
                id="spec-must"
                rows={2}
                disabled={disabled}
                className="ds-input w-full text-xs"
                value={listToText(spec.brand_visual?.must_have)}
                onChange={(e) => patchVisual({ must_have: textToList(e.target.value) })}
                placeholder="Mỗi dòng một thứ"
              />
            </div>
            <div>
              <label className="ds-label" htmlFor="spec-not">
                Tuyệt đối không có
              </label>
              <textarea
                id="spec-not"
                rows={2}
                disabled={disabled}
                className="ds-input w-full text-xs"
                value={listToText(spec.brand_visual?.do_not)}
                onChange={(e) => patchVisual({ do_not: textToList(e.target.value) })}
                placeholder="Mỗi dòng một thứ"
              />
            </div>
          </div>

          <div>
            <label className="ds-label" htmlFor="spec-palette">
              Màu chủ đạo
            </label>
            <input
              id="spec-palette"
              disabled={disabled}
              className="ds-input w-full text-xs"
              value={(spec.brand_visual?.palette || []).join(", ")}
              onChange={(e) =>
                patchVisual({
                  palette: e.target.value
                    .split(",")
                    .map((x) => x.trim())
                    .filter(Boolean),
                })
              }
              placeholder="#4f46e5, #f8fafc — cách nhau bằng dấu phẩy"
            />
          </div>

          {(spec.rules || []).length > 0 && (
            <details>
              <summary className="text-xs text-stone-500 cursor-pointer">
                Luật đang áp ({(spec.rules || []).length})
              </summary>
              <ul className="text-[11px] text-stone-500 mt-1 flex flex-col gap-0.5 list-disc pl-4">
                {(spec.rules || []).map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
              <p className="text-[11px] text-stone-400 mt-1">
                Luật sinh ra từ các mục ở trên. Muốn sửa tay thì mở chế độ JSON.
              </p>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

/** Nút đưa đặc tả về bản công cụ tự dựng — dùng khi sửa tay rồi thấy tệ hơn. */
export function ResetSpecButton({ onReset, disabled }: { onReset: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onReset} disabled={disabled} className="ds-btn ds-btn-ghost ds-btn-sm">
      <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" /> Về bản tự dựng
    </button>
  );
}
