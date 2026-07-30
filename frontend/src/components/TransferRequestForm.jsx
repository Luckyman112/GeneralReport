import { useState } from "react";
import { useAuth } from "../auth/AuthContext";

/** Заявка на перевод в другое формирование — требует одобрения заместителя+
 * обоих формирований (откуда и куда), см. app/api/transfer_requests.py.
 * После двойного одобрения боец замораживается до смены роли в Discord. */
export function TransferRequestForm({ currentRegimentId, onSubmit, onCancel }) {
  const { regiments } = useAuth();
  const otherRegiments = regiments.filter((r) => r.id !== currentRegimentId);
  const [toRegimentId, setToRegimentId] = useState(otherRegiments[0]?.id ?? "");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const isValid = toRegimentId && reason.trim();

  async function handleSubmit(e) {
    e.preventDefault();
    if (!isValid) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ toRegimentId: Number(toRegimentId), reason: reason.trim() });
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="report-form fade-in-up" onSubmit={handleSubmit}>
      <h3>Заявка на перевод</h3>
      <p className="hint-text">
        Нужно одобрение заместителя+ формирования, куда вы переводитесь, И формирования, откуда уходите. После
        одобрения обеими сторонами доступ к рапортам заморозится до смены роли формирования в Discord.
      </p>

      <label>
        Формирование, куда перевестись
        <select value={toRegimentId} onChange={(e) => setToRegimentId(e.target.value)}>
          {otherRegiments.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>

      <label>
        Причина перевода
        <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>

      {error && <p className="error-text">{error}</p>}

      <div className="report-form-actions">
        <button className="primary" type="submit" disabled={submitting || !isValid}>
          Отправить
        </button>
        <button className="ghost" type="button" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </form>
  );
}
