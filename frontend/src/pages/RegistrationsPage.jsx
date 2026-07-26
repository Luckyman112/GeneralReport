import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "../components/ToastContext";

const POLL_INTERVAL_MS = 20000;

/** Заявки на регистрацию новых бойцов, ожидающие решения — видны только тем
 * формированиям, к которым относится заявитель (по Discord-роли), заместителю/
 * командиру этого формирования, высшему командованию или администратору. */
export function RegistrationsPage() {
  const { token } = useAuth();
  const showToast = useToast();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  function load() {
    api
      .listPendingRegistrations(token)
      .then(setRequests)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function handleApprove(discordId) {
    try {
      await api.approveRegistration(token, discordId);
      showToast("Регистрация одобрена");
      load();
    } catch (e) {
      showToast(e.message, "error");
    }
  }

  async function handleReject(discordId) {
    try {
      await api.rejectRegistration(token, discordId);
      showToast("Регистрация отклонена");
      load();
    } catch (e) {
      showToast(e.message, "error");
    }
  }

  if (loading) return <div className="page-loading">Загрузка...</div>;

  return (
    <div className="violations-page">
      <h2>Регистрации</h2>
      <p className="hint-text">Заявки новых бойцов на регистрацию, ожидающие вашего решения.</p>

      {error && <p className="error-text">{error}</p>}

      {requests.length === 0 ? (
        <p className="empty-state">Заявок нет.</p>
      ) : (
        <div className="report-list">
          {requests.map((r) => (
            <div key={r.discord_id} className="report-row fade-in-up">
              <div className="report-row-header">
                {r.avatar_url && <img src={r.avatar_url} alt="" className="member-avatar" />}
                <span className="report-regiment">{r.username}</span>
                {r.regiment_names.map((name) => (
                  <span key={name} className="report-category">
                    {name}
                  </span>
                ))}
              </div>
              <p className="report-content">
                ИДН: {r.service_id} · Позывной: {r.callsign}
              </p>
              <div className="report-row-actions">
                <button className="primary" onClick={() => handleApprove(r.discord_id)}>
                  Одобрить
                </button>
                <button onClick={() => handleReject(r.discord_id)}>Отклонить</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
