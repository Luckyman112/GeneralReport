import { useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

/** Полноэкранная заглушка вместо интерфейса, пока новый боец не заполнил форму
 * регистрации (ИДН + позывной, звание всегда стартовое — рекрут) и её не одобрил
 * заместитель/командир формирования — до этого рапорты недоступны, даже с ролью. */
export function RegistrationGate() {
  const { token, user, refreshMe } = useAuth();
  const [serviceId, setServiceId] = useState("");
  const [callsign, setCallsign] = useState("");
  const [steamId, setSteamId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const alreadySubmitted = Boolean(user?.service_id) && user?.registration_status === "pending";
  const isRejected = user?.registration_status === "rejected";

  async function handleSubmit(e) {
    e.preventDefault();
    if (!serviceId.trim() || !callsign.trim() || !steamId.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.submitRegistration(token, {
        serviceId: serviceId.trim(),
        callsign: callsign.trim(),
        steamId: steamId.trim(),
      });
      await refreshMe();
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (alreadySubmitted) {
    return (
      <div className="registration-gate regiment-panel fade-in-up">
        <h2>Заявка на регистрацию отправлена</h2>
        <p className="hint-text">Ожидайте одобрения от заместителя или командира вашего формирования.</p>
      </div>
    );
  }

  return (
    <div className="registration-gate regiment-panel fade-in-up">
      <h2>Регистрация</h2>
      {isRejected && (
        <p className="error-text">Предыдущая заявка отклонена — заполните форму заново.</p>
      )}
      <p className="hint-text">
        Прежде чем получить доступ к рапортам, укажите ИДН и позывной. Звание при регистрации — Рекрут.
      </p>
      <form onSubmit={handleSubmit} className="report-form">
        <label>
          ИДН (4 цифры)
          <input type="text" maxLength={4} value={serviceId} onChange={(e) => setServiceId(e.target.value)} />
        </label>
        <label>
          Позывной
          <input type="text" value={callsign} onChange={(e) => setCallsign(e.target.value)} />
        </label>
        <label>
          Steam ID
          <input
            type="text"
            placeholder="например, STEAM_0:1:12345678"
            value={steamId}
            onChange={(e) => setSteamId(e.target.value)}
          />
        </label>
        {error && <p className="error-text">{error}</p>}
        <div className="report-form-actions">
          <button className="primary" type="submit" disabled={submitting}>
            Отправить на регистрацию
          </button>
        </div>
      </form>
    </div>
  );
}
