import { useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "./ToastContext";

function mskNow() {
  return new Date().toLocaleTimeString("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" });
}

/** Текст сообщения — должен совпадать с app/api/event_room.py::format_comms_message. */
function formatComms({ sender, recipient, message, time }) {
  return (
    "[ На коммуникатор бойцов пришло сообщение ]\n\n" +
    `От кого: ${sender.trim()}\n` +
    `Кому: ${recipient.trim()}\n\n` +
    `Сообщение: ${message.trim()}\n\n` +
    `[Время: ${time.trim()}]`
  );
}

/** Форма миника: сообщение «на коммуникатор бойцов». Можно скопировать готовый
 * текст или отправить ботом в канал из настроек (event_comms_channel_id). */
export function EventCommsForm() {
  const { token, access } = useAuth();
  const showToast = useToast();
  const [sender, setSender] = useState("");
  const [recipient, setRecipient] = useState("");
  const [message, setMessage] = useState("");
  const [time, setTime] = useState(mskNow);
  const [sending, setSending] = useState(false);

  if (!access?.is_event_submitter) return null;

  const filled = sender.trim() && recipient.trim() && message.trim();
  const text = formatComms({ sender, recipient, message, time });

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      showToast("Текст скопирован");
    } catch {
      showToast("Не удалось скопировать — выделите текст вручную", "error");
    }
  }

  async function handleSend(e) {
    e.preventDefault();
    setSending(true);
    try {
      await api.sendEventComms(token, { sender, recipient, message, time });
      showToast("Сообщение отправлено в Discord");
      setMessage("");
      setTime(mskNow());
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <h3>Сообщение на коммуникатор (миник)</h3>
      <form className="report-form fade-in-up" onSubmit={handleSend}>
        <label>
          От кого
          <input
            type="text"
            value={sender}
            maxLength={200}
            placeholder="Адмирала флота 11-ой секторальной армии"
            onChange={(e) => setSender(e.target.value)}
          />
        </label>
        <label>
          Кому
          <input
            type="text"
            value={recipient}
            maxLength={200}
            placeholder="Регулярным силам 11-ой секторальной армии"
            onChange={(e) => setRecipient(e.target.value)}
          />
        </label>
        <label>
          Сообщение
          <textarea rows={4} value={message} maxLength={1500} onChange={(e) => setMessage(e.target.value)} />
        </label>
        <label>
          Время
          <input type="text" value={time} maxLength={60} onChange={(e) => setTime(e.target.value)} />
        </label>
        <pre className="comms-preview">{text}</pre>
        <div className="report-form-actions">
          <button className="primary" type="submit" disabled={!filled || sending}>
            Отправить в Discord
          </button>
          <button type="button" className="ghost" disabled={!filled} onClick={handleCopy}>
            Скопировать текст
          </button>
        </div>
      </form>
    </>
  );
}
