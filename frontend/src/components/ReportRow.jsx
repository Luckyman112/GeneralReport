import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { StatusBadge } from "./StatusBadge";
import { CheckIcon, CrossIcon, GearIcon, TrashIcon } from "./icons";
import { formatMskDate } from "../utils/formatDate";
import { formatFullName, formatFullNameAtRank } from "../utils/formatName";
import { formatDetentionTarget, formatPunishmentType } from "../utils/punishment";

const CONTENT_PREVIEW_LENGTH = 320;

const DECISION_STATUS_LABELS = {
  pending: "ожидает",
  approved: "одобрено",
  rejected: "отклонено",
};

/** Строка решения одного формирования-участника совместного рапорта (см.
 * ReportCategory.is_joint) — своя пара одобрить/отклонить, независимая от
 * остальных формирований. */
function RegimentDecisionRow({ decision, canDecide, onDecide }) {
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  return (
    <li className="regiment-decision-row">
      <span className="regiment-decision-name">{decision.regiment_name}</span>
      <span className={`regiment-decision-status regiment-decision-status-${decision.status}`}>
        {DECISION_STATUS_LABELS[decision.status] || decision.status}
      </span>
      {decision.decided_by_user && (
        <span className="hint-text">— {formatFullName(decision.decided_by_user)}</span>
      )}
      {decision.rejection_reason && <span className="hint-text">({decision.rejection_reason})</span>}
      {canDecide && (
        <span className="regiment-decision-actions">
          {decision.status !== "approved" && (
            <button type="button" className="icon-button" onClick={() => onDecide("approved")}>
              <CheckIcon /> Одобрить
            </button>
          )}
          {!showRejectInput ? (
            decision.status !== "rejected" && (
              <button type="button" className="icon-button" onClick={() => setShowRejectInput(true)}>
                <CrossIcon /> Отклонить
              </button>
            )
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
                  onDecide("rejected", rejectReason);
                  setShowRejectInput(false);
                  setRejectReason("");
                }}
              >
                Подтвердить
              </button>
            </span>
          )}
        </span>
      )}
    </li>
  );
}

export function ReportRow({
  report,
  regimentName,
  regimentColor,
  categoryName,
  targetRegimentName,
  isOwn,
  canManage,
  canDelete,
  canReject = canManage,
  canSetPoints,
  decidableRegimentIds = [],
  onSubmitDraft,
  onApprove,
  onReject,
  onDecideRegiment,
  onEditContent,
  onDelete,
  onSetPoints,
  onDeleteImage,
}) {
  const [showRejectInput, setShowRejectInput] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [pointsDraft, setPointsDraft] = useState(report.points ?? "");
  const [showPointsPanel, setShowPointsPanel] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingContent, setEditingContent] = useState(false);
  const [contentDraft, setContentDraft] = useState(report.content);
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

  // Зеркальная копия (см. ReportCategory.mirrors_to_category_id) — статус
  // синхронизируется от исходного рапорта, тут его не меняют напрямую
  const isMirror = Boolean(report.mirror_of_report_id);
  canManage = canManage && !isMirror;
  canReject = canReject && !isMirror;
  canDelete = (canDelete ?? canManage) && !isMirror;

  // Совместная категория (см. ReportCategory.is_joint) — у рапорта нет единого
  // статуса, каждое формирование-участник решает своё независимо (regiment_decisions)
  const isJoint = (report.regiment_decisions || []).length > 0;
  const approvedCount = isJoint ? report.regiment_decisions.filter((d) => d.status === "approved").length : 0;

  const detentionTargetName = formatDetentionTarget(report);
  const punishmentLabel = formatPunishmentType(report);
  const canManageImages = canManage;
  const showPointsGear = canSetPoints || report.points !== null;
  const isLongContent = report.content.length > CONTENT_PREVIEW_LENGTH;
  const displayedContent =
    isLongContent && !expanded ? `${report.content.slice(0, CONTENT_PREVIEW_LENGTH)}…` : report.content;

  return (
    <div className={`report-row report-row-status-${report.status} fade-in-up`}>
      <div className="report-row-header">
        <span className="report-regiment" style={regimentColor ? { color: regimentColor } : undefined}>
          {regimentName}
        </span>
        {categoryName && <span className="report-category">{categoryName}</span>}
        {isMirror && <span className="hint-text">(зеркало из формирования)</span>}
        {isJoint ? (
          <span className="hint-text">
            Совместный: {approvedCount}/{report.regiment_decisions.length} одобрено
          </span>
        ) : (
          <StatusBadge status={report.status} />
        )}
        <span className="report-date">{formatMskDate(report.created_at)} МСК</span>

        {showPointsGear && (
          <span className="points-gear-wrap" ref={pointsWrapRef}>
            <button
              type="button"
              className="ghost points-gear-button"
              title="Баллы за рапорт"
              onClick={() => setShowPointsPanel((v) => !v)}
            >
              <GearIcon />
              {report.points !== null && <span className="points-gear-dot" />}
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
        Докладывает: <span style={regimentColor ? { color: regimentColor } : undefined}>{formatFullNameAtRank(report.author, report.author_rank)}</span>
      </p>
      {report.status === "approved" && report.updated_by_user && (
        <p className="report-byline">
          Рапорт одобрен:{" "}
          <span style={regimentColor ? { color: regimentColor } : undefined}>
            {formatFullNameAtRank(report.updated_by_user, report.updated_by_rank)}
          </span>
        </p>
      )}

      {isJoint && (
        <ul className="regiment-decision-list">
          {report.regiment_decisions.map((decision) => (
            <RegimentDecisionRow
              key={decision.regiment_id}
              decision={decision}
              canDecide={decidableRegimentIds.includes(decision.regiment_id)}
              onDecide={(status, reason) => onDecideRegiment(decision.regiment_id, status, reason)}
            />
          ))}
        </ul>
      )}

      {report.target_regiment_id && (
        <div className="detention-target-panel">
          <p className="hint-text">
            Задержан: <strong>{detentionTargetName || "не указан"}</strong>
            {targetRegimentName && ` · ${targetRegimentName}`}
          </p>
          <p className="hint-text">
            Наказание: <strong>{punishmentLabel}</strong>
            {report.punishment_amount && ` — ${report.punishment_amount}`}
          </p>
        </div>
      )}

      {editingContent ? (
        <div className="report-content-edit">
          <textarea rows={4} value={contentDraft} onChange={(e) => setContentDraft(e.target.value)} />
          <div className="report-row-actions">
            <button
              className="primary"
              disabled={!contentDraft.trim()}
              onClick={() => {
                onEditContent(contentDraft.trim());
                setEditingContent(false);
              }}
            >
              Сохранить
            </button>
            <button
              className="ghost"
              onClick={() => {
                setContentDraft(report.content);
                setEditingContent(false);
              }}
            >
              Отмена
            </button>
          </div>
        </div>
      ) : (
        <p className="report-content">
          {displayedContent}
          {isLongContent && (
            <button type="button" className="ghost report-expand-toggle" onClick={() => setExpanded((v) => !v)}>
              {expanded ? "Свернуть" : "Показать полностью"}
            </button>
          )}
        </p>
      )}

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
        {isOwn && report.status === "draft" && !editingContent && (
          <>
            <button className="primary" onClick={onSubmitDraft}>
              Отправить
            </button>
            <button className="icon-button" onClick={() => setEditingContent(true)}>
              Изменить
            </button>
          </>
        )}

        {!isJoint && canManage && report.status === "submitted" && (
          <button className="primary icon-button" onClick={onApprove}>
            <CheckIcon /> Одобрить
          </button>
        )}

        {!isJoint && canReject && (report.status === "submitted" || report.status === "approved") && (
          <>
            {!showRejectInput ? (
              <button className="icon-button" onClick={() => setShowRejectInput(true)}>
                <CrossIcon /> Отклонить
              </button>
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

        {(canDelete ?? canManage) && report.status !== "deleted" && (
          <button className="icon-button" onClick={() => setConfirmDelete(true)}>
            <TrashIcon /> Удалить
          </button>
        )}
        <ConfirmDialog
          open={confirmDelete}
          message="Удалить этот рапорт? Действие необратимо."
          onConfirm={() => {
            setConfirmDelete(false);
            onDelete();
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      </div>
    </div>
  );
}
