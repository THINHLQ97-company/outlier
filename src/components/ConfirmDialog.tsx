// Modal xác nhận dùng chung — port từ share-projects/marcow-crop
// (src/components/ConfirmDialog.tsx). Style theo pattern .ds-modal của hệ
// design Mắt Bão (src/index.css) — reskin 2026-09-22, giữ nguyên logic/API.
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
    <div className="ds-modal-overlay open" style={{ zIndex: 200 }}>
      <div className="ds-modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
        <div className="ds-modal-header">
          <h3 id="confirm-dialog-title" className="ds-modal-title font-display">
            {title}
          </h3>
        </div>
        <div className="ds-modal-body">
          <p className="text-sm text-stone-600 leading-relaxed">{message}</p>
        </div>
        <div className="ds-modal-footer">
          <button onClick={onCancel} className="ds-btn">
            {cancelText}
          </button>
          <button onClick={onConfirm} className="ds-btn ds-btn-primary">
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
