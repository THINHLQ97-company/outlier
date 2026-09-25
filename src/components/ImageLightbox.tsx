import { useEffect } from "react";
import { X, ExternalLink } from "lucide-react";
import { imageDisplayUrl } from "../services/http";

// Xem ảnh bài ở cỡ lớn.
//
// Ảnh trong danh sách chỉ nhỏ bằng con tem, mà thứ quyết định một bài có đáng
// remake hay không thường nằm ngay trong ảnh: chữ trên ảnh, bố cục, biểu cảm
// nhân vật. Không phóng to được thì phải mở sang Facebook mới xem được — mất
// mạch làm việc.

export default function ImageLightbox({
  url,
  title,
  sourceUrl,
  onClose,
}: {
  url: string;
  title?: string | null;
  sourceUrl?: string | null;
  onClose: () => void;
}) {
  // Đóng bằng Esc: mở ra xem nhanh rồi thoát, bắt đi tìm nút đóng là thừa.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="ds-modal-overlay open"
      style={{ zIndex: 120 }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title || "Xem ảnh"}
    >
      <div className="ds-modal !max-w-3xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-stone-200">
          <p className="text-sm font-medium text-stone-800 truncate flex-1 min-w-0">{title || "Ảnh bài viết"}</p>
          <div className="flex items-center gap-1 shrink-0">
            {sourceUrl && (
              <a
                href={sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="ds-btn ds-btn-ghost ds-btn-sm"
                title="Mở bài gốc"
              >
                <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" /> Bài gốc
              </a>
            )}
            <button type="button" onClick={onClose} className="ds-btn ds-btn-ghost ds-btn-sm" aria-label="Đóng">
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="p-3 bg-stone-900/5 max-h-[80vh] overflow-auto flex items-center justify-center">
          <img
            src={imageDisplayUrl(url) || undefined}
            alt={title || "Ảnh bài viết"}
            className="max-w-full h-auto rounded-lg"
          />
        </div>
      </div>
    </div>
  );
}
