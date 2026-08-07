import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { EmptyState } from "../components/EmptyState";
import { InlineSpinner } from "../components/InlineSpinner";
import { MemberSearchPicker } from "../components/MemberSearchPicker";
import { formatFullName } from "../utils/formatName";

const STATUS_LABELS = {
  pending: "Ожидает решения",
  approved: "Одобрено",
  rejected: "Отклонено",
};

function emptyAudience() {
  return { mode: "role", regiment_id: null, discord_ids: [] };
}

function emptyForm() {
  return {
    title: "",
    summary: "",
    objective: "",
    task: "",
    threat: "",
    briefing_start: "",
    participants: emptyAudience(),
    attached: emptyAudience(),
    commander_discord_id: "",
    map_id: "",
  };
}

function formToPayload(form) {
  return {
    summary: form.summary.trim() || null,
    objective: form.objective.trim() || null,
    task: form.task.trim() || null,
    threat: form.threat.trim() || null,
    briefing_start: form.briefing_start || null,
    participants: form.participants.mode === "role" ? form.participants : { ...form.participants, regiment_id: null },
    attached: form.attached.discord_ids.length || form.attached.regiment_id ? form.attached : null,
    commander_discord_id: form.commander_discord_id || null,
    map_id: form.map_id ? Number(form.map_id) : null,
  };
}

function payloadToForm(event) {
  const p = event.payload || {};
  return {
    title: event.title,
    summary: p.summary || "",
    objective: p.objective || "",
    task: p.task || "",
    threat: p.threat || "",
    briefing_start: p.briefing_start || "",
    participants: p.participants || emptyAudience(),
    attached: p.attached || emptyAudience(),
    commander_discord_id: p.commander_discord_id || "",
    map_id: p.map_id ? String(p.map_id) : "",
  };
}

/** Роль формирования либо конкретные люди — переиспользуется для "Участвующий
 * отряд/состав" и "Приписной состав" (см. решение пользователя про поля формы
 * ивента). */
function AudienceField({ label, value, onChange, regiments, members }) {
  function setMode(mode) {
    onChange({ ...value, mode });
  }

  function addPerson(discordId) {
    if (!discordId || value.discord_ids.includes(discordId)) return;
    onChange({ ...value, discord_ids: [...value.discord_ids, discordId] });
  }

  function removePerson(discordId) {
    onChange({ ...value, discord_ids: value.discord_ids.filter((id) => id !== discordId) });
  }

  return (
    <div className="add-category-form">
      <label>{label}</label>
      <div className="picker-row">
        <label className="checkbox-label">
          <input type="radio" checked={value.mode === "role"} onChange={() => setMode("role")} />
          Формирование
        </label>
        <label className="checkbox-label">
          <input type="radio" checked={value.mode === "people"} onChange={() => setMode("people")} />
          Люди
        </label>
      </div>
      {value.mode === "role" ? (
        <select
          value={value.regiment_id || ""}
          onChange={(e) => onChange({ ...value, regiment_id: e.target.value ? Number(e.target.value) : null })}
        >
          <option value="">— формирование —</option>
          {regiments.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      ) : (
        <>
          <MemberSearchPicker members={members} selectedId="" onSelect={addPerson} />
          {value.discord_ids.length > 0 && (
            <ul className="chip-list">
              {value.discord_ids.map((discordId) => {
                const m = members.find((mm) => mm.discord_id === discordId);
                return (
                  <li key={discordId} className="chip">
                    {m ? formatFullName(m) : discordId}
                    <button type="button" onClick={() => removePerson(discordId)}>
                      ×
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function EventForm({ initial, maps, regiments, members, onSubmit, onCancel, submitLabel }) {
  const [form, setForm] = useState(initial);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const isValid = form.title.trim().length > 0;

  async function handleSubmit(e) {
    e.preventDefault();
    if (!isValid) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ title: form.title.trim(), payload: formToPayload(form) });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="regiment-panel fade-in-up" onSubmit={handleSubmit}>
      <label>
        Название операции
        <input type="text" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
      </label>
      <label>
        Сводка об операции
        <textarea
          rows={3}
          value={form.summary}
          onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))}
        />
      </label>
      <label>
        Цель операции
        <input
          type="text"
          value={form.objective}
          onChange={(e) => setForm((f) => ({ ...f, objective: e.target.value }))}
        />
      </label>
      <label>
        Задача
        <input type="text" value={form.task} onChange={(e) => setForm((f) => ({ ...f, task: e.target.value }))} />
      </label>
      <label>
        Угрозы и вражеские силы
        <input type="text" value={form.threat} onChange={(e) => setForm((f) => ({ ...f, threat: e.target.value }))} />
      </label>
      <label>
        Начало брифинга
        <input
          type="datetime-local"
          value={form.briefing_start}
          onChange={(e) => setForm((f) => ({ ...f, briefing_start: e.target.value }))}
        />
      </label>

      <AudienceField
        label="Участвующий отряд/состав"
        value={form.participants}
        onChange={(v) => setForm((f) => ({ ...f, participants: v }))}
        regiments={regiments}
        members={members}
      />
      <AudienceField
        label="Приписной состав"
        value={form.attached}
        onChange={(v) => setForm((f) => ({ ...f, attached: v }))}
        regiments={regiments}
        members={members}
      />

      <label>
        Командующий операции
        <InfoHintInline text="Часто узнаётся только по ходу брифинга — можно оставить пустым сейчас и дозаполнить, пока заявка ожидает решения." />
        <MemberSearchPicker
          members={members}
          selectedId={form.commander_discord_id}
          onSelect={(id) => setForm((f) => ({ ...f, commander_discord_id: id }))}
        />
      </label>

      <label>
        Карта
        <select value={form.map_id} onChange={(e) => setForm((f) => ({ ...f, map_id: e.target.value }))}>
          <option value="">— без карты —</option>
          {maps.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>

      {error && <p className="error-text">{error}</p>}
      <div className="modal-actions">
        <button className="primary" type="submit" disabled={!isValid || submitting}>
          {submitting ? "Сохранение…" : submitLabel}
        </button>
        {onCancel && (
          <button className="ghost" type="button" onClick={onCancel}>
            Отмена
          </button>
        )}
      </div>
    </form>
  );
}

function InfoHintInline({ text }) {
  return <span className="hint-text"> {text}</span>;
}

function RejectInline({ onReject }) {
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}>
        Отклонить
      </button>
    );
  }

  return (
    <span className="reject-inline">
      <input
        type="text"
        placeholder="Причина отклонения"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <button type="button" disabled={!reason.trim()} onClick={() => onReject(reason.trim())}>
        Подтвердить
      </button>
      <button type="button" className="ghost" onClick={() => setOpen(false)}>
        Отмена
      </button>
    </span>
  );
}

/** Ивентрум — независимая от Рапортов/Инструкторской сущность: Ивентолог подаёт
 * заявку на ивент, Ассистент/Куратор ивентологии одобряют (при одобрении бот
 * шлёт карточку операции в Discord). Многие поля (например, командующего)
 * часто узнают только по ходу брифинга — заявку можно редактировать, пока она
 * ожидает решения (см. решение пользователя). */
export function EventRoomPage() {
  const { token, access, regiments } = useAuth();
  const [events, setEvents] = useState([]);
  const [maps, setMaps] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [newMapName, setNewMapName] = useState("");

  const canDecide = Boolean(access?.can_decide_event);
  const canSubmit = Boolean(access?.is_event_submitter);

  function load() {
    setLoading(true);
    Promise.all([api.listEvents(token), api.listEventMaps(token), api.getEventMemberCandidates(token)])
      .then(([eventsData, mapsData, membersData]) => {
        setEvents(eventsData);
        setMaps(mapsData);
        setMembers(membersData);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const pendingEvents = useMemo(() => events.filter((e) => e.status === "pending"), [events]);
  const decidedEvents = useMemo(() => events.filter((e) => e.status !== "pending"), [events]);
  const editingEvent = events.find((e) => e.id === editingId);

  async function handleCreate(body) {
    await api.createEvent(token, body);
    setShowForm(false);
    load();
  }

  async function handleUpdate(body) {
    await api.updateEvent(token, editingId, body);
    setEditingId(null);
    load();
  }

  async function handleApprove(id) {
    await api.approveEvent(token, id);
    load();
  }

  async function handleReject(id, reason) {
    await api.rejectEvent(token, id, reason);
    load();
  }

  async function handleAddMap() {
    if (!newMapName.trim()) return;
    await api.createEventMap(token, newMapName.trim());
    setNewMapName("");
    load();
  }

  async function handleDeleteMap(id) {
    await api.deleteEventMap(token, id);
    load();
  }

  if (loading) return <InlineSpinner />;

  return (
    <div className="page-container">
      <h2>Ивентрум</h2>
      <p className="hint-text">
        Заявки на ивенты от Ивентологов — одобряет Ассистент/Куратор ивентологии, при одобрении бот отправляет
        карточку операции в Discord.
      </p>

      {error && <p className="error-text">{error}</p>}

      {canSubmit && !showForm && !editingId && (
        <button className="primary" type="button" onClick={() => setShowForm(true)}>
          Подать заявку на ивент
        </button>
      )}

      {showForm && (
        <EventForm
          initial={emptyForm()}
          maps={maps}
          regiments={regiments}
          members={members}
          onSubmit={handleCreate}
          onCancel={() => setShowForm(false)}
          submitLabel="Подать заявку"
        />
      )}

      {editingEvent && (
        <EventForm
          initial={payloadToForm(editingEvent)}
          maps={maps}
          regiments={regiments}
          members={members}
          onSubmit={handleUpdate}
          onCancel={() => setEditingId(null)}
          submitLabel="Сохранить"
        />
      )}

      {canDecide && (
        <div className="regiment-panel">
          <h3>Очередь одобрения ({pendingEvents.length})</h3>
          {pendingEvents.length === 0 ? (
            <EmptyState text="Нет заявок, ожидающих решения." />
          ) : (
            <div className="report-list">
              {pendingEvents.map((ev) => (
                <div key={ev.id} className="report-row">
                  <div className="report-row-header">
                    <span className="report-regiment">{ev.title}</span>
                    <span className="report-category">подал {formatFullName(ev.submitted_by)}</span>
                  </div>
                  {ev.payload?.summary && <p className="report-row-content">{ev.payload.summary}</p>}
                  <div className="report-row-actions">
                    <button type="button" onClick={() => setEditingId(ev.id)}>
                      Редактировать
                    </button>
                    <button className="primary" type="button" onClick={() => handleApprove(ev.id)}>
                      Одобрить
                    </button>
                    <RejectInline onReject={(reason) => handleReject(ev.id, reason)} />
                  </div>
                </div>
              ))}
            </div>
          )}

          <h4>Карты</h4>
          {maps.length > 0 && (
            <ul className="chip-list">
              {maps.map((m) => (
                <li key={m.id} className="chip">
                  {m.name}
                  <button type="button" onClick={() => handleDeleteMap(m.id)}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="picker-row">
            <input
              type="text"
              placeholder="Название карты"
              value={newMapName}
              onChange={(e) => setNewMapName(e.target.value)}
            />
            <button type="button" onClick={handleAddMap} disabled={!newMapName.trim()}>
              Добавить карту
            </button>
          </div>
        </div>
      )}

      <div className="regiment-panel">
        <h3>{canDecide ? "Все заявки" : "Мои заявки"}</h3>
        {events.length === 0 ? (
          <EmptyState text="Заявок пока нет." />
        ) : (
          <div className="report-list">
            {(canDecide ? decidedEvents : events).map((ev) => (
              <div key={ev.id} className="report-row">
                <div className="report-row-header">
                  <span className="report-regiment">{ev.title}</span>
                  <span className="report-category">{STATUS_LABELS[ev.status]}</span>
                </div>
                {ev.status === "rejected" && ev.rejection_reason && (
                  <p className="report-rejection-reason">Причина отклонения: {ev.rejection_reason}</p>
                )}
                {ev.status === "pending" && !canDecide && (
                  <div className="report-row-actions">
                    <button type="button" onClick={() => setEditingId(ev.id)}>
                      Редактировать
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
