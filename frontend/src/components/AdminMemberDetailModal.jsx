import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { InlineSpinner } from "./InlineSpinner";
import { MemberDetailModal } from "./MemberDetailModal";
import { PeriodFilterBar } from "./PeriodFilterBar";
import { StatusBadge } from "./StatusBadge";
import { useToast } from "./ToastContext";
import { usePeriodFilter } from "../hooks/usePeriodFilter";
import { formatMskDate } from "../utils/formatDate";

const TABS = [
  { key: "admin", label: "Администрация" },
  { key: "rp", label: "РП" },
];

const SEVERITY_LABELS = { verbal: "Устный", strict: "Строгий" };

/** Досье администратора по клику на ник в сводке активности — рапорта
 * (раздельно деятельность/наказания) + переключатель на РП-профиль, если
 * человек реально состоит в каком-то формировании (см. решение пользователя,
 * п.6/п.8 — Администрация не привязана к формированию, это отдельная нон-РП
 * должность). Вкладка "РП" отдаёт управление существующему MemberDetailModal
 * целиком (не дублирует его логику) — свой "Закрыть" внутри неё возвращает на
 * вкладку "Администрация", а не закрывает всё окно. */
export function AdminMemberDetailModal({ discordId, onClose }) {
  const { token, access } = useAuth();
  const showToast = useToast();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("admin");
  const [rpMember, setRpMember] = useState(null);
  const [rpError, setRpError] = useState(null);

  const [reprimandReason, setReprimandReason] = useState("");
  const [reprimandSeverity, setReprimandSeverity] = useState("strict");
  const [issuingReprimand, setIssuingReprimand] = useState(false);

  const canManageReprimands = Boolean(access?.can_decide_admin_report || access?.can_decide_event);

  const reportsPeriod = usePeriodFilter("all");
  const filteredActivityReports = useMemo(
    () => (detail ? detail.activity_reports.filter((r) => reportsPeriod.isInPeriod(r.created_at)) : []),
    [detail, reportsPeriod]
  );
  const filteredPunishmentReports = useMemo(
    () => (detail ? detail.punishment_reports.filter((r) => reportsPeriod.isInPeriod(r.created_at)) : []),
    [detail, reportsPeriod]
  );

  function loadDetail() {
    setLoading(true);
    setError(null);
    return api
      .getAdminRosterMemberDetail(token, discordId)
      .then(setDetail)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, discordId]);

  async function handleIssueReprimand(e) {
    e.preventDefault();
    if (!reprimandReason.trim()) return;
    setIssuingReprimand(true);
    try {
      await api.issueAdminReprimand(token, {
        targetDiscordId: discordId,
        reason: reprimandReason.trim(),
        severity: reprimandSeverity,
      });
      setReprimandReason("");
      showToast("Выговор выдан");
      loadDetail();
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setIssuingReprimand(false);
    }
  }

  async function handleRevokeReprimand(reprimandId) {
    try {
      await api.revokeAdminReprimand(token, reprimandId);
      showToast("Выговор снят");
      loadDetail();
    } catch (err) {
      showToast(err.message, "error");
    }
  }

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
                {(detail.activity_reports.length > 0 || detail.punishment_reports.length > 0) && (
                  <PeriodFilterBar
                    preset={reportsPeriod.preset}
                    setPreset={reportsPeriod.setPreset}
                    customFrom={reportsPeriod.customFrom}
                    setCustomFrom={reportsPeriod.setCustomFrom}
                    customTo={reportsPeriod.customTo}
                    setCustomTo={reportsPeriod.setCustomTo}
                  />
                )}

                <h4>Отчёт деятельности ({filteredActivityReports.length})</h4>
                {filteredActivityReports.length === 0 ? (
                  <p className="hint-text">Отчётов нет.</p>
                ) : (
                  <ul className="member-report-list">
                    {filteredActivityReports.map((r) => (
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

                <h4>Отчёт наказаний ({filteredPunishmentReports.length})</h4>
                {filteredPunishmentReports.length === 0 ? (
                  <p className="hint-text">Отчётов нет.</p>
                ) : (
                  <ul className="member-report-list">
                    {filteredPunishmentReports.map((r) => (
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

                <h4>Выговоры ({detail.reprimands.length})</h4>
                {detail.reprimands.length === 0 ? (
                  <p className="hint-text">Выговоров нет.</p>
                ) : (
                  <ul className="member-report-list">
                    {detail.reprimands.map((r) => (
                      <li key={r.id}>
                        <span className={`status-badge ${r.revoked_at ? "status-rejected" : "status-approved"}`}>
                          {r.revoked_at ? "Снят" : "Активен"}
                        </span>
                        <span className="report-category">{SEVERITY_LABELS[r.severity] || r.severity}</span>
                        <span className="member-report-date">{formatMskDate(r.issued_at)} МСК</span>
                        <p>{r.reason}</p>
                        {!r.revoked_at && canManageReprimands && (
                          <div className="report-form-actions">
                            <button type="button" className="ghost error-text" onClick={() => handleRevokeReprimand(r.id)}>
                              Снять
                            </button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {canManageReprimands && (
                  <form className="report-form" onSubmit={handleIssueReprimand}>
                    <h4>Выдать выговор</h4>
                    <label>
                      Причина
                      <textarea
                        value={reprimandReason}
                        onChange={(e) => setReprimandReason(e.target.value)}
                        required
                      />
                    </label>
                    <label>
                      Тип
                      <select value={reprimandSeverity} onChange={(e) => setReprimandSeverity(e.target.value)}>
                        <option value="strict">Строгий</option>
                        <option value="verbal">Устный</option>
                      </select>
                    </label>
                    <div className="report-form-actions">
                      <button className="primary" type="submit" disabled={issuingReprimand}>
                        Выдать
                      </button>
                    </div>
                  </form>
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
