import { useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

/** Отдельная кнопка/модалка для рассылки объявления всем — доступна тому кругу
 * ролей/людей, который настроил администратор (см. ViolationsPage, раздел настроек
 * модуля). */
export function BroadcastModal({ onClose }) {
  const { token } = useAuth();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);

  async function handleSend(e) {
    e.preventDefault();
    if (!title.trim() || !body.trim()) return;
    setSending(true);
    setError(null);
    try {
      await api.sendBroadcast(token, { title: title.trim(), body: body.trim() });
      setSent(true);
      setTitle("");
      setBody("");
    } catch (e) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" aria-label="Закрыть" onClick={onClose}>
          ×
        </button>
        <h3>Объявление всем</h3>
        <form onSubmit={handleSend}>
          <label>
            Заголовок
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label>
            Текст
            <textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
          </label>
          {error && <p className="error-text">{error}</p>}
          {sent && <p className="hint-text">Отправлено.</p>}
          <div className="modal-actions">
            <button className="primary" type="submit" disabled={sending || !title.trim() || !body.trim()}>
              Отправить
            </button>
            <button className="ghost" type="button" onClick={onClose}>
              Закрыть
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
