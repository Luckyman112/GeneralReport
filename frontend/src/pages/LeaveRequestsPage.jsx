import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { formatMskDate } from "../utils/formatDate";
import { formatFullName } from "../utils/formatName";

const STATUS_LABELS = {
  pending: "Ожидает решения",
  approved: "Одобрена",
  rejected: "Отклонена",
};

function LeaveRequestForm({ regiments, onSubmit, onCancel }) {
  const [regimentId, setRegimentId] = useState(regiments[0]?.id ?? "");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const isValid = regimentId && startDate && endDate && endDate >= startDate && reason.trim();

  async function handleSubmit(e) {
    e.preventDefault();
    if (!isValid) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ regimentId: Number(regimentId), startDate, endDate, reason: reason.trim() });
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="report-form fade-in-up" onSubmit={handleSubmit}>
      <h3>Заявка на отпуск</h3>

      {regiments.length > 1 && (
        <label>
          Формирование
          <select value={regimentId} onChange={(e) => setRegimentId(e.target.value)}>
            {regiments.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <label>
        С даты
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
      </label>
      <label>
        По дату
        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
      </label>
      <label>
        Причина
        <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>

      {error && <p className="error-text">{error}</p>}

      <div className="report-form-actions">
        <button className="primary" type="submit" disabled={submitting || !isValid}>
          Подать заявку
        </button>
        <button className="ghost" type="button" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </form>
  );
}

export function LeaveRequestsPage() {
  const { token, user, access, regiments } = useAuth();
  const [requests, setRequests] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const ownRegimentIds = useMemo(
    () => [...new Set([...(access?.commander_regiment_ids || []), ...(access?.soldier_regiment_ids || [])])],
    [access]
  );
  const ownRegiments = useMemo(
    () => (access?.is_admin || access?.is_high_command ? regiments : regiments.filter((r) => ownRegimentIds.includes(r.id))),
    [regiments, access, ownRegimentIds]
  );

  async function load() {
    try {
      setRequests(await api.listLeaveRequests(token));
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    load().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function canDecide(request) {
    return access?.is_admin || access?.is_high_command || (access?.commander_regiment_ids || []).includes(request.regiment_id);
  }

  async function handleCreate(payload) {
    await api.createLeaveRequest(token, payload);
    setShowForm(false);
    await load();
  }

  async function handleApprove(id) {
    try {
      await api.approveLeaveRequest(token, id);
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleReject(id) {
    try {
      await api.rejectLeaveRequest(token, id);
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  if (loading) return <div className="page-loading">Загрузка...</div>;

  return (
    <div className="violations-page">
      <h2>Отпуска</h2>

      {error && <p className="error-text">{error}</p>}

      {ownRegiments.length > 0 && !showForm && (
        <button className="primary" onClick={() => setShowForm(true)}>
          Подать заявку на отпуск
        </button>
      )}

      {showForm && (
        <LeaveRequestForm regiments={ownRegiments} onSubmit={handleCreate} onCancel={() => setShowForm(false)} />
      )}

      {requests.length === 0 ? (
        <p className="empty-state">Заявок нет.</p>
      ) : (
        <div className="report-list">
          {requests.map((r) => (
            <div key={r.id} className="report-row fade-in-up">
              <div className="report-row-header">
                <span className="report-regiment">{formatFullName(r.user)}</span>
                <span className="report-category">
                  {r.start_date} — {r.end_date}
                </span>
                <span className="report-date">{STATUS_LABELS[r.status]}</span>
              </div>
              <p className="report-content">{r.reason}</p>
              <p className="report-byline">Подана: {formatMskDate(r.created_at)} МСК</p>
              {r.decided_by_user && (
                <p className="report-byline">Решение: {formatFullName(r.decided_by_user)}</p>
              )}
              {r.status === "pending" && canDecide(r) && r.user.discord_id !== user?.discord_id && (
                <div className="report-row-actions">
                  <button className="primary" onClick={() => handleApprove(r.id)}>
                    Одобрить
                  </button>
                  <button onClick={() => handleReject(r.id)}>Отклонить</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
