import { useState } from "react";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { ConfirmDialog } from "../ConfirmDialog";
import { useToast } from "../ToastContext";
import { actionsFor } from "./requestModel";

/** Кнопки по заявке — одни и те же в карточке списка и в окне просмотра.
 * «На редакцию» и «Отклонить» раскрывают строку для короткого пояснения:
 * автор должен понимать, что не так. */
export function RequestActions({ ev, canDecide, onChanged, onEdit, onView, compact }) {
  const { token, user } = useAuth();
  const showToast = useToast();
  const a = actionsFor(ev, user, canDecide);
  const [mode, setMode] = useState(null); // null | "revision" | "reject"
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  async function run(fn, okText) {
    setBusy(true);
    try {
      await fn();
      if (okText) showToast(okText);
      setMode(null);
      setText("");
      onChanged?.();
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      setBusy(false);
    }
  }

  const isAuthor = ev.submitted_by?.id === user?.id;

  return (
    <div className="request-actions">
      <div className="request-actions-row">
        {onView && (
          <button type="button" className="ghost" onClick={() => onView(ev)}>
            Просмотр
          </button>
        )}
        {a.send && (
          <button type="button" className="primary" disabled={busy} onClick={() => run(() => api.sendEvent(token, ev.id), "Отправлено в Discord")}>
            Отправить в Discord
          </button>
        )}
        {a.edit && (
          <button type="button" onClick={() => onEdit(ev)}>
            {isAuthor && ev.status === "revision" ? "Исправить" : "Редактировать"}
          </button>
        )}
        {a.approve && (
          <button type="button" className={a.send ? "" : "primary"} disabled={busy} onClick={() => run(() => api.approveEvent(token, ev.id), "Одобрено")}>
            Одобрить
          </button>
        )}
        {a.revision && (
          <button type="button" onClick={() => setMode(mode === "revision" ? null : "revision")}>
            На редакцию
          </button>
        )}
        {a.reject && (
          <button type="button" className="ghost error-text" onClick={() => setMode(mode === "reject" ? null : "reject")}>
            Отклонить
          </button>
        )}
        {a.cancel && !compact && (
          <button type="button" className="ghost error-text" onClick={() => setConfirmCancel(true)}>
            Отменить
          </button>
        )}
      </div>

      {mode && (
        <div className="request-actions-note">
          <input
            autoFocus
            value={text}
            maxLength={2000}
            placeholder={mode === "revision" ? "Что поправить — коротко, автор увидит это сообщение" : "Причина отклонения"}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setMode(null)}
          />
          <button
            type="button"
            className={mode === "revision" ? "primary" : "primary danger"}
            disabled={!text.trim() || busy}
            onClick={() =>
              mode === "revision"
                ? run(() => api.sendEventToRevision(token, ev.id, text.trim()), "Возвращено на редакцию")
                : run(() => api.rejectEvent(token, ev.id, text.trim()), "Отклонено")
            }
          >
            {mode === "revision" ? "Вернуть автору" : "Отклонить"}
          </button>
          <button type="button" className="ghost" onClick={() => setMode(null)}>
            Отмена
          </button>
        </div>
      )}

      <ConfirmDialog
        open={confirmCancel}
        message={
          <>
            Отменить одобренную заявку? Если она уже отправлена, сообщение в Discord будет помечено «Отменено».
            <input
              type="text"
              placeholder="Причина (необязательно)"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              style={{ width: "100%", marginTop: 10 }}
            />
          </>
        }
        confirmLabel="Отменить заявку"
        onConfirm={() => {
          setConfirmCancel(false);
          run(() => api.cancelEvent(token, ev.id, cancelReason.trim()), "Заявка отменена");
        }}
        onCancel={() => setConfirmCancel(false)}
      />
    </div>
  );
}
