import { createPortal } from "react-dom";

/** Подтверждающий диалог перед необратимым действием — управляется локальным
 * состоянием { open, message, onConfirm } в компоненте-вызывающем. */
export function ConfirmDialog({ open, message, confirmLabel = "Удалить", onConfirm, onCancel }) {
  if (!open) return null;

  return createPortal(
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <p>{message}</p>
        <div className="modal-actions">
          <button className="ghost" onClick={onCancel}>
            Отмена
          </button>
          <button className="primary danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
