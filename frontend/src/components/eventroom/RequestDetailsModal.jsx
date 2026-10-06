import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { formatMskDate } from "../../utils/formatDate";
import { formatFullName } from "../../utils/formatName";
import { useToast } from "../ToastContext";
import { KindBadge, StatusChip } from "./RequestCard";
import { RequestActions } from "./RequestActions";
import { KINDS, actionsFor, formatMini, kindOf } from "./requestModel";

function audienceText(a, regiments, members) {
  if (!a) return null;
  if (a.mode === "role") {
    if (a.custom_name?.trim()) return a.custom_name.trim();
    return regiments.find((r) => r.id === a.regiment_id)?.name || null;
  }
  const names = (a.discord_ids || []).map((id) => {
    const m = members.find((x) => x.discord_id === id);
    return m ? formatFullName(m) : id;
  });
  return names.length ? names.join(", ") : null;
}

function Row({ label, children }) {
  if (children === null || children === undefined || children === "" || (Array.isArray(children) && !children.length)) return null;
  return (
    <div className="request-detail-row">
      <span className="request-field-label">{label}</span>
      <div>{children}</div>
    </div>
  );
}

/** Окно просмотра заявки: что подано (в читаемом виде), её путь по статусам и
 * все действия. Для заявки на ивент — ещё карточка-досье и сообщения по ивенту. */
export function RequestDetailsModal({ ev, canDecide, regiments, members, maps, onClose, onChanged, onEdit }) {
  const { token, user } = useAuth();
  const k = kindOf(ev);
  const p = ev.payload || {};
  const [cardUrl, setCardUrl] = useState(null);
  const [cardLoading, setCardLoading] = useState(false);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => () => cardUrl && URL.revokeObjectURL(cardUrl), [cardUrl]);

  async function loadCard() {
    setCardLoading(true);
    try {
      const blob = await api.getEventCard(token, ev.id);
      setCardUrl(URL.createObjectURL(blob));
    } catch {
      // карточка вспомогательная — без неё окно остаётся рабочим
    } finally {
      setCardLoading(false);
    }
  }

  const commander = p.commander_discord_id ? members.find((m) => m.discord_id === p.commander_discord_id) : null;
  const mapName = p.map_id ? maps.find((m) => m.id === Number(p.map_id))?.name : null;
  const a = actionsFor(ev, user, canDecide);

  return createPortal(
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal request-modal" role="dialog" aria-label={ev.title}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Закрыть">
          ×
        </button>
        <h3>
          <KindBadge ev={ev} /> {ev.title}
        </h3>
        <div className="request-detail-status">
          <StatusChip ev={ev} />
          <span className="hint-text">{KINDS[k].label}</span>
        </div>

        <div className="request-timeline">
          <span>Подал {formatFullName(ev.submitted_by)} · {formatMskDate(ev.created_at)} МСК</span>
          {ev.status === "revision" && ev.decided_by && <span>Вернул на редакцию {formatFullName(ev.decided_by)} · {formatMskDate(ev.decided_at)} МСК</span>}
          {["approved", "cancelled"].includes(ev.status) && ev.decided_by && (
            <span>Одобрил {formatFullName(ev.decided_by)} · {formatMskDate(ev.decided_at)} МСК</span>
          )}
          {ev.status === "rejected" && ev.decided_by && <span>Отклонил {formatFullName(ev.decided_by)} · {formatMskDate(ev.decided_at)} МСК</span>}
          {ev.notified_at && (
            <span>
              Отправлено в Discord{ev.sent_by ? ` (${formatFullName(ev.sent_by)})` : ""} · {formatMskDate(ev.notified_at)} МСК
            </span>
          )}
          {ev.status === "cancelled" && (
            <span>
              Отменил {formatFullName(ev.cancelled_by)} · {formatMskDate(ev.cancelled_at)} МСК
              {ev.cancellation_reason ? ` — ${ev.cancellation_reason}` : ""}
            </span>
          )}
        </div>

        {ev.revision_comment && (ev.status === "revision" || canDecide) && (
          <p className="request-revision-note">
            <b>{ev.status === "revision" ? "Что поправить" : "Последнее замечание"}:</b> {ev.revision_comment}
          </p>
        )}
        {ev.status === "rejected" && ev.rejection_reason && <p className="report-rejection-reason">Причина отклонения: {ev.rejection_reason}</p>}

        <div className="request-details">
          {k === "mini" && <pre className="comms-preview">{formatMini(p)}</pre>}
          {k === "rp" && (
            <>
              <Row label="Сюжет">{p.summary}</Row>
              <Row label="Начало">{p.briefing_start ? `${formatMskDate(p.briefing_start)} МСК` : null}</Row>
              <Row label="Место">{p.planet_name}</Row>
              <Row label="Участники">{audienceText(p.participants, regiments, members)}</Row>
              <Row label="Дополнительно">{p.notes}</Row>
            </>
          )}
          {k === "event" && (
            <>
              <Row label="Сводка">{p.summary}</Row>
              <Row label="Цель">{p.objective}</Row>
              <Row label="Задачи">{p.tasks?.length ? <ol>{p.tasks.map((t, i) => <li key={i}>{t}</li>)}</ol> : null}</Row>
              <Row label="Доп. задачи">{p.extra_tasks?.length ? <ol>{p.extra_tasks.map((t, i) => <li key={i}>{t}</li>)}</ol> : null}</Row>
              <Row label="Угрозы">{p.threat}</Row>
              <Row label="Начало брифинга">{p.briefing_start ? `${formatMskDate(p.briefing_start)} МСК` : null}</Row>
              <Row label="Командующий">{commander ? formatFullName(commander) : "определится на брифинге"}</Row>
              <Row label="Состав">{audienceText(p.participants, regiments, members)}</Row>
              <Row label="Приписной состав">{audienceText(p.attached, regiments, members)}</Row>
              <Row label="Карта">{mapName}</Row>
              <Row label="Планета">{[p.planet_name, p.landscape, p.weather, p.flora_fauna].filter(Boolean).join(" · ") || null}</Row>
              <div className="request-preview">
                {cardUrl ? (
                  <img src={cardUrl} alt="Карточка операции" className="request-card-img" />
                ) : (
                  <button type="button" className="ghost" onClick={loadCard} disabled={cardLoading}>
                    {cardLoading ? "Загрузка…" : "Показать карточку-досье"}
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        <RequestActions
          ev={ev}
          canDecide={canDecide}
          onChanged={onChanged}
          onEdit={(x) => {
            onClose();
            onEdit(x);
          }}
        />

        {a.messages && <EventMessagesPanel ev={ev} canDecide={canDecide} onChanged={onChanged} />}
      </div>
    </div>,
    document.body,
  );
}

const MESSAGE_STATUS_LABELS = { pending: "Ожидает решения", approved: "Одобрено", rejected: "Отклонено" };

/** Дополнительные сообщения по уже одобренному ивенту (отдельный поток
 * одобрения, см. app/models/event_message.py). */
function EventMessagesPanel({ ev, canDecide, onChanged }) {
  const { token, user } = useAuth();
  const showToast = useToast();
  const [text, setText] = useState("");
  const [composing, setComposing] = useState(false);
  const isAuthor = ev.submitted_by.id === user.id;

  async function run(fn, ok) {
    try {
      await fn();
      if (ok) showToast(ok);
      onChanged?.();
    } catch (e) {
      showToast(e.message, "error");
    }
  }

  return (
    <div className="event-messages-panel">
      <span className="request-field-label">Сообщения по ивенту</span>
      {ev.messages.length > 0 && (
        <ul className="member-report-list">
          {ev.messages.map((m) => (
            <li key={m.id}>
              <span className="report-category">{MESSAGE_STATUS_LABELS[m.status]}</span>
              <p className="report-row-content">{m.content}</p>
              <p className="hint-text">
                {formatMskDate(m.created_at)} МСК — {formatFullName(m.submitted_by)}
                {m.status === "rejected" && m.rejection_reason ? ` · Причина: ${m.rejection_reason}` : ""}
                {m.sent_at ? ` · Отправлено ${formatMskDate(m.sent_at)} МСК` : ""}
              </p>
              <div className="report-form-actions">
                {m.status === "pending" && canDecide && (
                  <>
                    <button type="button" onClick={() => run(() => api.decideEventMessage(token, m.id, { status: "approved" }), "Одобрено")}>
                      Одобрить
                    </button>
                    <button
                      type="button"
                      className="ghost error-text"
                      onClick={() => {
                        const reason = window.prompt("Причина отклонения");
                        if (reason?.trim()) run(() => api.decideEventMessage(token, m.id, { status: "rejected", rejectionReason: reason.trim() }), "Отклонено");
                      }}
                    >
                      Отклонить
                    </button>
                  </>
                )}
                {m.status === "approved" && !m.sent_at && (isAuthor || canDecide) && (
                  <button type="button" className="primary" onClick={() => run(() => api.sendEventMessage(token, m.id), "Отправлено")}>
                    Отправить
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {isAuthor &&
        (composing ? (
          <div className="request-actions-note">
            <input value={text} placeholder="Текст сообщения" onChange={(e) => setText(e.target.value)} />
            <button
              type="button"
              disabled={!text.trim()}
              onClick={() =>
                run(async () => {
                  await api.createEventMessage(token, ev.id, text.trim());
                  setText("");
                  setComposing(false);
                }, "Сообщение подано")
              }
            >
              Подать
            </button>
            <button type="button" className="ghost" onClick={() => setComposing(false)}>
              Отмена
            </button>
          </div>
        ) : (
          <button type="button" className="ghost" onClick={() => setComposing(true)}>
            + Сообщение по ивенту
          </button>
        ))}
    </div>
  );
}
