import { useEffect, useRef, useState } from "react";
import { StatusBadge } from "./StatusBadge";
import { formatMskDate } from "../utils/formatDate";
import { formatFullName } from "../utils/formatName";

const CONTENT_PREVIEW_LENGTH = 320;

export function ReportRow({
  report,
  regimentName,
  regimentColor,
  categoryName,
  isOwn,
  canManage,
  canSetPoints,
  onSubmitDraft,
  onApprove,
  onReject,
  onDelete,
  onSetPoints,
  onDeleteImage,
}) {
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [pointsDraft, setPointsDraft] = useState(report.points ?? "");
  const [showPointsPanel, setShowPointsPanel] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const pointsWrapRef = useRef(null);

  useEffect(() => {
    if (!showPointsPanel) return undefined;
    function handleOutsideClick(e) {
      if (pointsWrapRef.current && !pointsWrapRef.current.contains(e.target)) {
        setShowPointsPanel(false);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [showPointsPanel]);

  const canManageImages = canManage;
  const showPointsGear = canSetPoints || report.points !== null;
  const isLongContent = report.content.length > CONTENT_PREVIEW_LENGTH;
  const displayedContent =
    isLongContent && !expanded ? `${report.content.slice(0, CONTENT_PREVIEW_LENGTH)}…` : report.content;

  return (
    <div
      className="report-row fade-in-up"
      style={regimentColor ? { borderLeft: `3px solid ${regimentColor}` } : undefined}
    >
      <div className="report-row-header">
        <span className="report-regiment" style={regimentColor ? { color: regimentColor } : undefined}>
          {regimentName}
        </span>
        {categoryName && <span className="report-category">{categoryName}</span>}
        <StatusBadge status={report.status} />
        <span className="report-date">{formatMskDate(report.created_at)} МСК</span>

        {showPointsGear && (
          <span className="points-gear-wrap" ref={pointsWrapRef}>
            <button
              type="button"
              className="ghost points-gear-button"
              title="Баллы за рапорт"
              onClick={() => setShowPointsPanel((v) => !v)}
            >
              ⚙{report.points !== null && <span className="points-gear-dot" />}
            </button>

            {showPointsPanel && (
              <div className="points-popover" onClick={(e) => e.stopPropagation()}>
                {canSetPoints ? (
                  <>
                    <label className="points-inline">
                      Баллы
                      <input
                        type="number"
                        placeholder="Баллы"
                        value={pointsDraft}
                        onChange={(e) => setPointsDraft(e.target.value)}
                      />
                    </label>
                    <button
                      disabled={pointsDraft === ""}
                      onClick={() => {
                        onSetPoints(pointsDraft === "" ? null : Number(pointsDraft));
                        setShowPointsPanel(false);
                      }}
                    >
                      Сохранить
                    </button>
                  </>
                ) : (
                  <p className="hint-text">Баллы: {report.points}</p>
                )}
              </div>
            )}
          </span>
        )}
      </div>

      <p className="report-byline">
        Докладывает: <span style={regimentColor ? { color: regimentColor } : undefined}>{formatFullName(report.author)}</span>
      </p>
      {report.status === "approved" && report.updated_by_user && (
        <p className="report-byline">
          Рапорт одобрен:{" "}
          <span style={regimentColor ? { color: regimentColor } : undefined}>
            {formatFullName(report.updated_by_user)}
          </span>
        </p>
      )}

      <p className="report-content">
        {displayedContent}
        {isLongContent && (
          <button type="button" className="ghost report-expand-toggle" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "Свернуть" : "Показать полностью"}
          </button>
        )}
      </p>

      {report.rejection_reason && (
        <p className="report-rejection-reason">Причина отклонения: {report.rejection_reason}</p>
      )}

      {report.images.length > 0 && (
        <div className="report-images">
          {report.images.map((img) => (
            <div key={img.id} className="report-image-thumb">
              <a href={img.url} target="_blank" rel="noreferrer">
                <img src={img.url} alt="" />
              </a>
              {canManageImages && (
                <button className="report-image-remove" onClick={() => onDeleteImage(img.id)}>
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
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
