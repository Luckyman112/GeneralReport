import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { EmptyState } from "../components/EmptyState";
import { CheckIcon, CrossIcon } from "../components/icons";
import { PageLoading } from "../components/PageLoading";
import { useToast } from "../components/ToastContext";
import { useLiveEvents } from "../hooks/useLiveEvents";

// SSE обновляет мгновенно — поллинг оставлен редким запасным вариантом
const POLL_INTERVAL_MS = 60000;

/** Заявки на регистрацию новых бойцов, ожидающие решения — видны только тем
 * формированиям, к которым относится заявитель (по Discord-роли), заместителю/
 * командиру этого формирования, высшему командованию или администратору. */
export function RegistrationsPage() {
  const { token } = useAuth();
  const showToast = useToast();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    api
      .listPendingRegistrations(token)
      .then(setRequests)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  useLiveEvents("registrations", load);

  useEffect(() => {
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load]);

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

  if (loading) return <PageLoading />;

  return (
    <div className="violations-page">
      <h2>Регистрации</h2>
      <p className="hint-text">Заявки новых бойцов на регистрацию, ожидающие вашего решения.</p>

      {error && <p className="error-text">{error}</p>}

      {requests.length === 0 ? (
        <EmptyState text="Заявок нет." />
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
                ИДН: {r.service_id} · Позывной: {r.callsign} · Steam ID: {r.steam_id}
              </p>
              <div className="report-row-actions">
                <button className="primary icon-button" onClick={() => handleApprove(r.discord_id)}>
                  <CheckIcon /> Одобрить
                </button>
                <button className="icon-button" onClick={() => handleReject(r.discord_id)}>
                  <CrossIcon /> Отклонить
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
