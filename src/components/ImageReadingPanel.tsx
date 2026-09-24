import { Image as ImageIcon, Type, Sparkles } from "lucide-react";
import { imageDisplayUrl } from "../services/http";
import type { ImageReadingRecord } from "../types";

// Nội dung đọc được từ ảnh của bài.
//
// Vì sao tách ra một khu riêng thay vì nhét vào phần cấu trúc: với nhiều bài,
// đây MỚI là nội dung chính còn caption chỉ là một dòng dẫn. Người dùng cần
// thấy ngay chữ trong ảnh nói gì, không phải đi tìm trong một khối phân tích.

const KIND_LABEL: Record<string, string> = {
  meme: "Ảnh chế",
  anh_chat: "Ảnh chụp đoạn chat",
  infographic: "Đồ hoạ thông tin",
  anh_that: "Ảnh chụp thật",
  do_hoa: "Ảnh thiết kế",
  khac: "Ảnh",
};

export default function ImageReadingPanel({
  reading,
  thumbnailUrl,
}: {
  reading: ImageReadingRecord;
  thumbnailUrl?: string | null;
}) {
  return (
    <div className="ds-card">
      <div className="ds-card-body">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <h3 className="font-bold text-stone-800 flex items-center gap-2">
            <ImageIcon className="w-4 h-4 text-storm-500" aria-hidden="true" />
            Nội dung trong ảnh
          </h3>
          <div className="flex items-center gap-1.5">
            <span className="ds-badge">{KIND_LABEL[reading.imageKind] || "Ảnh"}</span>
            {reading.carriesMainContent && (
              <span className="ds-badge ds-badge-info">nội dung chính nằm ở đây</span>
            )}
          </div>
        </div>

        <div className="flex gap-3 mt-3">
          {thumbnailUrl && (
            <img
              src={imageDisplayUrl(thumbnailUrl) || undefined}
              alt=""
              className="w-28 h-28 rounded-lg object-cover bg-stone-100 shrink-0"
              loading="lazy"
            />
          )}

          <div className="min-w-0 flex-1 flex flex-col gap-2.5">
            {reading.textInImage ? (
              <div>
                <h4 className="text-xs font-semibold text-stone-700 flex items-center gap-1.5">
                  <Type className="w-3.5 h-3.5 text-storm-500" aria-hidden="true" />
                  Chữ trong ảnh
                </h4>
                {/* Giữ nguyên xuống dòng: ảnh chat và meme phụ thuộc vào cách ngắt dòng. */}
                <pre className="text-xs text-stone-700 mt-1 whitespace-pre-wrap font-sans bg-stone-50 border border-stone-100 rounded-lg px-2.5 py-2">
                  {reading.textInImage}
                </pre>
              </div>
            ) : (
              <p className="text-xs text-stone-400">Ảnh không có chữ đọc được.</p>
            )}

            {reading.description && (
              <p className="text-xs text-stone-600">
                <span className="font-medium text-stone-700">Ảnh vẽ gì:</span> {reading.description}
              </p>
            )}

            {reading.technique && (
              <p className="text-xs text-storm-900 bg-storm-50 border border-storm-200 rounded-lg px-2.5 py-2">
                <span className="font-medium inline-flex items-center gap-1">
                  <Sparkles className="w-3 h-3" aria-hidden="true" /> Gây chú ý bằng:
                </span>{" "}
                {reading.technique}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
