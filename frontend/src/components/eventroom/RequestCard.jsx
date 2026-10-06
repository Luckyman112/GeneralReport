import { formatMskDate } from "../../utils/formatDate";
import { formatFullName } from "../../utils/formatName";
import { RequestActions } from "./RequestActions";
import { KINDS, STATUS_INFO, kindOf, statusOf } from "./requestModel";

export function StatusChip({ ev }) {
  const st = statusOf(ev);
  const info = STATUS_INFO[st] || { label: ev.status, tone: "pending" };
  return <span className={`request-status tone-${info.tone}`}>{info.label}</span>;
}

export function KindBadge({ ev }) {
  const k = kindOf(ev);
  return <span className={`request-kind-badge kind-${k}`}>{KINDS[k].short}</span>;
}

/** Строка заявки в списке: тип, название, статус, главное замечание и кнопки. */
export function RequestCard({ ev, canDecide, showAuthor, onChanged, onEdit, onView }) {
  const start = ev.payload?.briefing_start;
  return (
    <div className={`request-card status-${statusOf(ev)}`}>
      <div className="request-card-head">
        <KindBadge ev={ev} />
        <button type="button" className="request-card-title" onClick={() => onView(ev)}>
          {ev.title}
        </button>
        <StatusChip ev={ev} />
      </div>
      <div className="request-card-meta">
        {showAuthor && <span>{formatFullName(ev.submitted_by)}</span>}
        <span>подана {formatMskDate(ev.created_at)} МСК</span>
        {start && <span>начало {formatMskDate(start)} МСК</span>}
        {ev.notified_at && ev.sent_by && <span>отправил {formatFullName(ev.sent_by)}</span>}
      </div>
      {ev.status === "revision" && ev.revision_comment && (
        <p className="request-revision-note">
          <b>Что поправить{ev.decided_by ? ` (${formatFullName(ev.decided_by)})` : ""}:</b> {ev.revision_comment}
        </p>
      )}
      {ev.status === "pending" && ev.revision_comment && canDecide && (
        <p className="hint-text">Было замечание: {ev.revision_comment}</p>
      )}
      {ev.status === "rejected" && ev.rejection_reason && (
        <p className="report-rejection-reason">Причина отклонения: {ev.rejection_reason}</p>
      )}
      {ev.status === "cancelled" && (
        <p className="report-rejection-reason">
          Отменено{ev.cancelled_by ? ` (${formatFullName(ev.cancelled_by)})` : ""}
          {ev.cancellation_reason ? `: ${ev.cancellation_reason}` : ""}
        </p>
      )}
      <RequestActions ev={ev} canDecide={canDecide} onChanged={onChanged} onEdit={onEdit} onView={onView} compact />
    </div>
  );
}
