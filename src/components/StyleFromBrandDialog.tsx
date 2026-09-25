import { useEffect, useState } from "react";
import { Loader2, X, Sparkles, AlertTriangle, Info } from "lucide-react";
import { listBrands } from "../services/brands";
import { createStyleFromBrand } from "../services/styles";
import type { BrandRow, StyleFromBrandResult } from "../types";

// Sinh nét vẽ từ hồ sơ Thương hiệu.
//
// Trước đây muốn có phong cách thì BẮT BUỘC phải tải lên một ảnh mẫu đúng ý.
// Trang mới chưa có ảnh nào như vậy, nên mỗi lần vẽ lại chọn phong cách khác —
// ảnh ra không ai nhận ra là cùng một trang. Hồ sơ thương hiệu đã có đủ thứ cần
// (bán gì, nói với ai, giọng nào, nhận diện hình ảnh) để suy ra một bộ nét vẽ,
// sinh một lần rồi dùng cho mọi ảnh về sau.
//
// Kết quả nói rõ nét vẽ bám hồ sơ tới đâu: có khai nhận diện hình ảnh thì là màu
// và khuôn ảnh trang đã chọn; chưa khai thì chỉ là suy luận từ tính cách — hợp lý
// nhưng không phải quyết định của chủ trang.

export default function StyleFromBrandDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (row: StyleFromBrandResult) => void;
}) {
  const [brands, setBrands] = useState<BrandRow[]>([]);
  const [brandId, setBrandId] = useState("");
  const [name, setName] = useState("");
  const [isShared, setIsShared] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<StyleFromBrandResult | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const rows = await listBrands();
        setBrands(rows);
        if (rows.length === 1) setBrandId(rows[0].id);
      } catch (e: any) {
        setError(e?.message || "Không tải được danh sách thương hiệu.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleGenerate() {
    if (!brandId) {
      setError("Chọn thương hiệu trước.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const row = await createStyleFromBrand({ brandId, name: name.trim() || undefined, isShared });
      setResult(row);
      onCreated(row);
    } catch (e: any) {
      setError(e?.message || "Sinh nét vẽ thất bại.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ds-modal-overlay open" style={{ zIndex: 100 }}>
      <div
        className="ds-modal max-w-lg max-h-[90vh] overflow-y-auto"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sfb-title"
      >
        <div className="ds-modal-header">
          <h3 id="sfb-title" className="ds-modal-title font-display">
            Sinh nét vẽ từ Thương hiệu
          </h3>
          <button onClick={onClose} className="ds-modal-close" aria-label="Đóng">
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="ds-modal-body flex flex-col gap-3">
          {!result ? (
            <>
              <p className="text-xs text-stone-500">
                Đọc hồ sơ thương hiệu (bán gì, nói với ai, giọng nào, nhận diện hình ảnh) rồi thiết kế một bộ nét vẽ cho
                trang. Sinh một lần, dùng cho mọi ảnh về sau — đó là chỗ ảnh của trang trở nên đồng bộ.
              </p>

              {loading ? (
                <div className="flex items-center gap-2 text-sm text-stone-400 py-4">
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Đang tải thương hiệu...
                </div>
              ) : brands.length === 0 ? (
                <div className="ds-alert ds-alert-warning !text-xs">
                  Chưa có thương hiệu nào. Vào menu Thương hiệu khai hồ sơ trước — không có hồ sơ thì không suy ra được
                  nét vẽ nào đúng trang.
                </div>
              ) : (
                <>
                  <div>
                    <label className="ds-label" htmlFor="sfb-brand">
                      Thương hiệu
                    </label>
                    <select
                      id="sfb-brand"
                      className="ds-input w-full"
                      value={brandId}
                      onChange={(e) => setBrandId(e.target.value)}
                    >
                      <option value="">— Chọn thương hiệu —</option>
                      {brands.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="ds-label" htmlFor="sfb-name">
                      Tên phong cách <span className="font-normal text-stone-400">(để trống thì tự đặt)</span>
                    </label>
                    <input
                      id="sfb-name"
                      className="ds-input w-full"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="vd: Nét thô vui"
                    />
                  </div>

                  <label className="flex items-center gap-1.5 text-sm text-stone-600">
                    <input
                      type="checkbox"
                      checked={isShared}
                      onChange={(e) => setIsShared(e.target.checked)}
                      className="accent-storm-600"
                    />
                    Chia sẻ cả nhóm
                  </label>

                  <p className="text-[11px] text-stone-400">
                    Cũng làm được từ Claude: gọi <code className="font-mono">style_brand_material</code> rồi{" "}
                    <code className="font-mono">style_create</code> — Claude tự đọc hồ sơ và tự viết bộ trường.
                  </p>
                </>
              )}

              {error && (
                <div role="alert" className="ds-alert ds-alert-danger">
                  {error}
                </div>
              )}

              <button
                type="button"
                onClick={handleGenerate}
                disabled={busy || loading || !brandId}
                className="ds-btn ds-btn-primary justify-center mt-1"
              >
                {busy ? (
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Sparkles className="w-4 h-4" aria-hidden="true" />
                )}
                {busy ? "Đang thiết kế nét vẽ..." : "Sinh nét vẽ"}
              </button>
            </>
          ) : (
            <>
              <div className="ds-alert ds-alert-success !text-xs">
                Đã tạo phong cách <strong>{result.name}</strong>. Chọn được ngay khi vẽ ảnh.
              </div>

              {result.rationale && (
                <div className="border border-stone-200 rounded-lg px-3 py-2">
                  <p className="text-xs font-medium text-stone-600">Vì sao nét vẽ này khớp trang</p>
                  <p className="text-xs text-stone-500 mt-1 whitespace-pre-wrap">{result.rationale}</p>
                </div>
              )}

              {/* Nói thẳng nét vẽ bám hồ sơ tới đâu — người dùng cần biết cái gì
                  là màu trang đã chọn, cái gì chỉ là suy luận. */}
              <div className={`ds-alert !text-xs ${result.grounded ? "ds-alert-info" : "ds-alert-warning"}`}>
                {result.grounded ? (
                  <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                )}
                <span>{result.grounded ? "Nét vẽ bám nhận diện hình ảnh đã khai trong hồ sơ." : result.warning}</span>
              </div>

              {result.missingKeyFields.length > 0 && (
                <div className="ds-alert ds-alert-warning !text-xs">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>
                    Trường then chốt chưa quyết được: <strong>{result.missingKeyFields.join(", ")}</strong>. Bấm "Sửa" ở
                    phong cách vừa tạo để điền, hoặc "Vẽ minh hoạ" rồi "Phân tích nét vẽ" để AI bóc từ ảnh.
                  </span>
                </div>
              )}

              <p className="text-[11px] text-stone-400">
                Phong cách chưa có ảnh minh hoạ — bấm "Vẽ minh hoạ" ở thẻ phong cách để xem nét vẽ ra thế nào.
              </p>

              <button type="button" onClick={onClose} className="ds-btn ds-btn-secondary justify-center mt-1">
                Đóng
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
