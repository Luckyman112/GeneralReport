import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { InlineSpinner } from "./InlineSpinner";
import { MemberDetailModal } from "./MemberDetailModal";
import { StatusBadge } from "./StatusBadge";
import { formatMskDate } from "../utils/formatDate";

const TABS = [
  { key: "admin", label: "Администрация" },
  { key: "rp", label: "РП" },
];

/** Досье администратора по клику на ник в сводке активности — рапорта
 * (раздельно деятельность/наказания) + переключатель на РП-профиль, если
 * человек реально состоит в каком-то формировании (см. решение пользователя,
 * п.6/п.8 — Администрация не привязана к формированию, это отдельная нон-РП
 * должность). Вкладка "РП" отдаёт управление существующему MemberDetailModal
 * целиком (не дублирует его логику) — свой "Закрыть" внутри неё возвращает на
 * вкладку "Администрация", а не закрывает всё окно. */
export function AdminMemberDetailModal({ discordId, onClose }) {
  const { token } = useAuth();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("admin");
  const [rpMember, setRpMember] = useState(null);
  const [rpError, setRpError] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .getAdminRosterMemberDetail(token, discordId)
      .then(setDetail)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token, discordId]);

  useEffect(() => {
    if (tab !== "rp" || !detail?.regiment_id || rpMember || rpError) return;
    api
      .getMembers(token, detail.regiment_id)
      .then((members) => {
        const found = members.find((m) => m.discord_id === discordId);
        if (found) setRpMember(found);
        else setRpError("Участник не найден в составе формирования");
      })
      .catch((e) => setRpError(e.message));
  }, [tab, detail, token, discordId, rpMember, rpError]);

  if (tab === "rp" && rpMember) {
    return (
      <MemberDetailModal
        member={rpMember}
        regimentId={detail.regiment_id}
        canEdit={false}
        onClose={() => setTab("admin")}
      />
    );
  }

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
            <p className="hint-text">{detail.rank_label}</p>

            <div className="report-form-actions" style={{ marginBottom: "0.75rem" }}>
              {TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className={tab === t.key ? "primary" : "ghost"}
                  onClick={() => setTab(t.key)}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {tab === "admin" && (
              <>
                <h4>Отчёт деятельности ({detail.activity_reports.length})</h4>
                {detail.activity_reports.length === 0 ? (
                  <p className="hint-text">Отчётов нет.</p>
                ) : (
                  <ul className="member-report-list">
                    {detail.activity_reports.map((r) => (
                      <li key={r.id}>
                        <StatusBadge status={r.status} />
                        <span className="member-report-date">{formatMskDate(r.created_at)} МСК</span>
                        {r.status === "rejected" && r.rejection_reason && (
                          <p className="report-rejection-reason">Причина отклонения: {r.rejection_reason}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                <h4>Отчёт наказаний ({detail.punishment_reports.length})</h4>
                {detail.punishment_reports.length === 0 ? (
                  <p className="hint-text">Отчётов нет.</p>
                ) : (
                  <ul className="member-report-list">
                    {detail.punishment_reports.map((r) => (
                      <li key={r.id}>
                        <StatusBadge status={r.status} />
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

            {tab === "rp" &&
              (!detail.regiment_id ? (
                <p className="hint-text">Формирование не определено.</p>
              ) : rpError ? (
                <p className="error-text">{rpError}</p>
              ) : (
                <InlineSpinner />
              ))}
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
