import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { InlineSpinner } from "./InlineSpinner";
import { StatusBadge } from "./StatusBadge";
import { formatMskDate } from "../utils/formatDate";

const EVENT_TYPE_LABELS = { mini: "Мини-ивент", combat: "Боевой вылет" };

/** Досье участника Ивентрума по клику на строку ростера — ранг + его заявки
 * на ивенты и отчёты о проведённых мероприятиях (см. решение пользователя:
 * агрегированных счётчиков в таблице недостаточно, нужно видеть детали). */
export function EventMemberDetailModal({ discordId, onClose }) {
  const { token } = useAuth();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .getEventRosterMemberDetail(token, discordId)
      .then(setDetail)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token, discordId]);

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" aria-label="Закрыть" onClick={onClose}>
          ×
        </button>
        {loading ? (
          <InlineSpinner />
        ) : error ? (
          <p className="error-text">{error}</p>
        ) : (
          <>
            <h3>{detail.username}</h3>
            <p className="hint-text">
              {detail.role}
              {detail.rank && ` · ${detail.rank.code} — ${detail.rank.name}`}
            </p>

            <h4>Заявки на ивент ({detail.events.length})</h4>
            {detail.events.length === 0 ? (
              <p className="hint-text">Заявок нет.</p>
            ) : (
              <ul className="member-report-list">
                {detail.events.map((ev) => (
                  <li key={ev.id}>
                    <StatusBadge status={ev.status} />
                    <span className="report-regiment">{ev.title}</span>
                    <span className="member-report-date">{formatMskDate(ev.created_at)} МСК</span>
                    {ev.status === "rejected" && ev.rejection_reason && (
                      <p className="report-rejection-reason">Причина отклонения: {ev.rejection_reason}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <h4>Отчёты о мероприятиях ({detail.activity_reports.length})</h4>
            {detail.activity_reports.length === 0 ? (
              <p className="hint-text">Отчётов нет.</p>
            ) : (
              <ul className="member-report-list">
                {detail.activity_reports.map((r) => (
                  <li key={r.id}>
                    <StatusBadge status={r.status} />
                    <span className="report-category">{EVENT_TYPE_LABELS[r.event_type] || r.event_type}</span>
                    <span className="member-report-date">{formatMskDate(r.created_at)} МСК</span>
                    {r.status === "rejected" && r.rejection_reason && (
                      <p className="report-rejection-reason">Причина отклонения: {r.rejection_reason}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
