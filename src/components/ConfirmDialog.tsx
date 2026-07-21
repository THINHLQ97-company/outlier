// Modal xác nhận dùng chung — port từ share-projects/marcow-crop
// (src/components/ConfirmDialog.tsx), style theo token storm-* (đã đổi sang
// bảng màu cam đất marcow-crop, xem src/index.css + CLAUDE.md mục 4).
interface Props {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmText = "Đồng ý",
  cancelText = "Hủy bỏ",
  onConfirm,
  onCancel,
}: Props) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm flex flex-col gap-4">
        <h3 className="text-xl font-semibold text-stone-800 font-display">{title}</h3>
        <p className="text-sm text-stone-600 leading-relaxed">{message}</p>
        <div className="flex gap-3 justify-end mt-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100 rounded-xl transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm font-medium text-white bg-storm-600 hover:bg-storm-700 rounded-xl transition-colors shadow-sm"
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
