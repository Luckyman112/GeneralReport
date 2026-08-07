import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { StatusBadge } from "./StatusBadge";
import { formatMskDate } from "../utils/formatDate";
import { formatFullNameAtRank } from "../utils/formatName";

/** Обзор для командира: рапорты бойца за текущее звание (с даты назначения до
 * сейчас) + выполненные требования по категориям для следующего звания. Открывается
 * кнопкой "Доступно повышение" в таблице состава. */
export function PromotionReviewModal({ requestId, onClose }) {
  const { token } = useAuth();
  const navigate = useNavigate();
  const [review, setReview] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .getPromotionReview(token, requestId)
      .then(setReview)
      .catch((e) => setError(e.message));
  }, [token, requestId]);

  function goToReport(report) {
    onClose();
    navigate(`/reports?regiment=${report.regiment_id}&category=${report.category_id ?? ""}`);
  }

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" aria-label="Закрыть" onClick={onClose}>
          ×
        </button>
        <h3>Обзор повышения</h3>

        {error && <p className="error-text">{error}</p>}

        {review && (
          <>
            <p>
              {review.from_rank ? `${review.from_rank.code} — ${review.from_rank.name}` : "—"} →{" "}
              <strong>
                {review.to_rank.code} — {review.to_rank.name}
              </strong>
            </p>
            <p className="hint-text">
              Период: {review.period_start ? formatMskDate(review.period_start) : "—"} — {formatMskDate(review.period_end)}{" "}
              МСК
            </p>
            {review.status !== "pending" && (
              <p className="hint-text">
                {review.status === "approved" ? "Одобрил" : "Отклонил"}:{" "}
                {review.decided_by ? formatFullNameAtRank(review.decided_by, review.decided_by.rank) : "—"}
                {review.decided_at && ` · ${formatMskDate(review.decided_at)} МСК`}
              </p>
            )}

            {review.category_requirements.length > 0 && (
              <>
                <h4>Требования по категориям</h4>
                <ul className="requirement-checklist">
                  {review.category_requirements.map((req) => (
                    <li
                      key={req.requirement_id}
                      className={req.satisfied ? "requirement-item requirement-item-done" : "requirement-item"}
                    >
                      <span className="requirement-check">{req.satisfied && "✓"}</span>
                      <span className="requirement-label">
                        {req.category_name} ({req.count_current} / {req.count_required})
                        {req.is_mandatory && <span className="tag-mandatory">обязательное</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}

            <h4>Рапорты за звание ({review.reports.length})</h4>
            {review.reports.length === 0 ? (
              <p className="hint-text">Рапортов нет.</p>
            ) : (
              <ul className="member-report-list">
                {review.reports.map((r) => (
                  <li key={r.id} className="clickable-row" onClick={() => goToReport(r)}>
                    <StatusBadge status={r.status} />
                    {r.category_name && <span className="report-category"> {r.category_name}</span>}
                    {r.points !== null && <span className="category-points-badge"> Баллы: {r.points}</span>}
                    <span className="member-report-date">{formatMskDate(r.created_at)} МСК</span>
                    <p className="member-report-content">{r.content}</p>
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
