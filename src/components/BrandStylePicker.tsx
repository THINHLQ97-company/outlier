import { useEffect, useState } from "react";
import { Loader2, Palette, AlertTriangle } from "lucide-react";
import { listStyles } from "../services/styles";
import { updateBrand } from "../services/brands";
import { imageDisplayUrl } from "../services/http";
import type { StyleRow } from "../types";

// Nét vẽ của trang — mọi ảnh remake vẽ theo nét này.
//
// Thiếu chỗ này, luồng remake vẽ theo nét MẶC ĐỊNH của Gemini (bóng bẩy, kiểu
// chibi) dù trang vẽ phẳng 2D. Nhân vật có đúng ảnh mẫu thì nhìn vẫn không ra
// trang mình. Luồng Sáng tạo được chọn phong cách mỗi lần vẽ; remake thì tự
// động nên phải gắn sẵn một lần ở đây.

export default function BrandStylePicker({
  brandId,
  value,
  onChanged,
}: {
  brandId: string;
  value: string | null | undefined;
  onChanged: () => void;
}) {
  const [styles, setStyles] = useState<StyleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listStyles()
      .then(setStyles)
      .catch((e) => setError(e?.message || "Không tải được thư viện phong cách."))
      .finally(() => setLoading(false));
  }, []);

  async function choose(id: string) {
    setSaving(true);
    setError(null);
    try {
      await updateBrand(brandId, { defaultStyleId: id || null } as any);
      onChanged();
    } catch (e: any) {
      setError(e?.message || "Không lưu được.");
    } finally {
      setSaving(false);
    }
  }

  const current = styles.find((s) => s.id === value);
  const img = current && !current.imageMissing ? imageDisplayUrl(current.referenceImageUrl) : null;

  return (
    <div className="ds-card">
      <div className="ds-card-body">
        <div className="flex items-start gap-3">
          <div className="w-16 h-16 rounded-lg overflow-hidden bg-stone-100 shrink-0 flex items-center justify-center">
            {img ? (
              <img src={img} alt={current?.name} className="w-full h-full object-cover" />
            ) : (
              <Palette className="w-6 h-6 text-stone-300" aria-hidden="true" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <label htmlFor={`brand-style-${brandId}`} className="text-sm font-semibold text-stone-800">
              Nét vẽ của trang
            </label>
            <p className="text-xs text-stone-500 mt-0.5">
              Mọi ảnh remake vẽ theo nét này. Chưa chọn thì công cụ vẽ theo nét mặc định của nó — nhân vật đúng mà nhìn
              vẫn không ra trang mình.
            </p>
            <div className="flex items-center gap-2 mt-2">
              <select
                id={`brand-style-${brandId}`}
                className="ds-input w-auto max-w-full"
                value={value || ""}
                onChange={(e) => choose(e.target.value)}
                disabled={loading || saving}
              >
                <option value="">— Chưa chọn (nét mặc định) —</option>
                {styles.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              {saving && <Loader2 className="w-4 h-4 animate-spin text-stone-400" aria-hidden="true" />}
            </div>
            {!value && !loading && (
              <p className="text-[11px] text-amber-700 mt-1.5 flex items-start gap-1">
                <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" aria-hidden="true" />
                Chưa có nét nào khớp trang? Vào Thư viện → Phong cách, tải lên một ảnh thật của trang để công cụ bóc nét
                vẽ, hoặc bấm "Sinh từ Thương hiệu".
              </p>
            )}
            {error && <p className="text-[11px] text-red-600 mt-1">{error}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
