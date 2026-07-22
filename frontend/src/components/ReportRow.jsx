import { useState } from "react";
import { StatusBadge } from "./StatusBadge";

export function ReportRow({ report, regimentName, isOwn, canManage, onSubmitDraft, onApprove, onReject, onDelete }) {
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  return (
    <div className="report-row">
      <div className="report-row-header">
        <span className="report-regiment">{regimentName}</span>
        <StatusBadge status={report.status} />
        <span className="report-date">{new Date(report.created_at).toLocaleString("ru-RU")}</span>
      </div>

      <p className="report-content">{report.content}</p>

      {report.rejection_reason && (
        <p className="report-rejection-reason">Причина отклонения: {report.rejection_reason}</p>
      )}

      <div className="report-row-actions">
        {isOwn && report.status === "draft" && (
          <button className="primary" onClick={onSubmitDraft}>
            Отправить
          </button>
        )}

        {canManage && report.status === "submitted" && (
          <>
            <button className="primary" onClick={onApprove}>
              Одобрить
            </button>
            {!showRejectInput ? (
              <button onClick={() => setShowRejectInput(true)}>Отклонить</button>
            ) : (
              <span className="reject-inline">
                <input
                  type="text"
                  placeholder="Причина отклонения"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                />
                <button
                  onClick={() => {
                    onReject(rejectReason);
                    setShowRejectInput(false);
                    setRejectReason("");
                  }}
                >
                  Подтвердить
                </button>
              </span>
            )}
          </>
        )}

        {canManage && report.status !== "deleted" && <button onClick={onDelete}>Удалить</button>}
      </div>
    </div>
  );
}
