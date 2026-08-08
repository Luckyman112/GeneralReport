import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { DateTimePicker } from "../components/DateTimePicker";
import { EmptyState } from "../components/EmptyState";
import { InlineSpinner } from "../components/InlineSpinner";
import { MemberSearchPicker } from "../components/MemberSearchPicker";
import { formatFullName } from "../utils/formatName";

const STATUS_LABELS = {
  pending: "Ожидает решения",
  approved: "Одобрено",
  rejected: "Отклонено",
};

const ROLE_LABELS = {
  куратор: "Куратор",
  ассистент: "Ассистент",
  ивентолог: "Ивентолог",
};

function emptyAudience() {
  return { mode: "role", regiment_id: null, custom_name: "", discord_ids: [] };
}

function emptyForm() {
  return {
    title: "",
    summary: "",
    objective: "",
    tasks: [""],
    extraTasks: [""],
    threat: "",
    briefing_start: "",
    participants: emptyAudience(),
    attached: emptyAudience(),
    commander_discord_id: "",
    map_id: "",
    map_image_url: "",
  };
}

function formToPayload(form) {
  return {
    summary: form.summary.trim() || null,
    objective: form.objective.trim() || null,
    tasks: form.tasks.map((t) => t.trim()).filter(Boolean),
    extra_tasks: form.extraTasks.map((t) => t.trim()).filter(Boolean),
    threat: form.threat.trim() || null,
    briefing_start: form.briefing_start || null,
    participants:
      form.participants.mode === "role"
        ? { mode: "role", regiment_id: form.participants.custom_name ? null : form.participants.regiment_id, custom_name: form.participants.custom_name || null }
        : { mode: "people", discord_ids: form.participants.discord_ids },
    attached:
      form.attached.mode === "role"
        ? form.attached.regiment_id || form.attached.custom_name
          ? { mode: "role", regiment_id: form.attached.custom_name ? null : form.attached.regiment_id, custom_name: form.attached.custom_name || null }
          : null
        : form.attached.discord_ids.length
          ? { mode: "people", discord_ids: form.attached.discord_ids }
          : null,
    commander_discord_id: form.commander_discord_id || null,
    map_id: form.map_id ? Number(form.map_id) : null,
    map_image_url: form.map_image_url || null,
  };
}

function payloadToForm(event) {
  const p = event.payload || {};
  return {
    title: event.title,
    summary: p.summary || "",
    objective: p.objective || "",
    tasks: p.tasks && p.tasks.length ? p.tasks : [""],
    extraTasks: p.extra_tasks && p.extra_tasks.length ? p.extra_tasks : [""],
    threat: p.threat || "",
    briefing_start: p.briefing_start || "",
    participants: { ...emptyAudience(), ...(p.participants || {}) },
    attached: { ...emptyAudience(), ...(p.attached || {}) },
    commander_discord_id: p.commander_discord_id || "",
    map_id: p.map_id ? String(p.map_id) : "",
    map_image_url: p.map_image_url || "",
  };
}

/** Роль формирования (либо своё название, если формирование нишевое и его нет
 * в каталоге CRM — см. решение пользователя) либо конкретные люди —
 * переиспользуется для "Участвующий отряд/состав" и "Приписной состав". */
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

  const isCustom = value.regiment_id === "__custom__";

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
        <>
          <select
            value={isCustom ? "__custom__" : value.regiment_id || ""}
            onChange={(e) => {
              if (e.target.value === "__custom__") {
                onChange({ ...value, regiment_id: "__custom__", custom_name: value.custom_name || " " });
              } else {
                onChange({ ...value, regiment_id: e.target.value ? Number(e.target.value) : null, custom_name: "" });
              }
            }}
          >
            <option value="">— формирование —</option>
            {regiments.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
            <option value="__custom__">— другое (вписать) —</option>
          </select>
          {isCustom && (
            <input
              type="text"
              placeholder="Название формирования"
              value={value.custom_name.trim()}
              onChange={(e) => onChange({ ...value, custom_name: e.target.value })}
            />
          )}
        </>
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

/** Список задач либо доп. задач — два независимых заполняемых списка (см.
 * решение пользователя: например 3 задачи и 4 доп. задачи), каждый со своей
 * нумерацией в карточке. */
function TasksField({ tasks, onChange, label, addLabel }) {
  function setTask(idx, value) {
    onChange(tasks.map((t, i) => (i === idx ? value : t)));
  }
  function addTask() {
    onChange([...tasks, ""]);
  }
  function removeTask(idx) {
    onChange(tasks.length > 1 ? tasks.filter((_, i) => i !== idx) : [""]);
  }

  return (
    <div className="add-category-form">
      {tasks.map((t, idx) => (
        <label key={idx}>
          {tasks.length === 1 ? label : `${label} ${idx + 1}`}
          <span className="picker-row">
            <input type="text" value={t} onChange={(e) => setTask(idx, e.target.value)} />
            <button type="button" className="ghost" onClick={() => removeTask(idx)} disabled={tasks.length === 1 && !t}>
              ×
            </button>
          </span>
        </label>
      ))}
      <button type="button" className="ghost" onClick={addTask}>
        {addLabel}
      </button>
    </div>
  );
}

function MapImageField({ value, onChange }) {
  const { token } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const { url } = await api.uploadEventMapImage(token, file);
      onChange(url);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  return (
    <label>
      Своё изображение карты (необязательно)
      {value ? (
        <span className="picker-row">
          <img src={value} alt="Карта" style={{ maxHeight: 80, borderRadius: 6 }} />
          <button type="button" className="ghost" onClick={() => onChange("")}>
            Убрать
          </button>
        </span>
      ) : (
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={handleFile} disabled={uploading} />
      )}
      {error && <p className="error-text">{error}</p>}
    </label>
  );
}

function EventForm({ initial, maps, regiments, members, onSubmit, onCancel, submitLabel }) {
  const { token } = useAuth();
  const [form, setForm] = useState(initial);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewRequestRef = useRef(0);

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

  // Предпросмотр включается автоматически по мере заполнения формы (см.
  // решение пользователя), с задержкой после последнего изменения — иначе
  // рендер карточки летел бы на бэкенд на каждое нажатие клавиши
  useEffect(() => {
    if (!form.title.trim()) {
      setPreviewUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return null;
      });
      return undefined;
    }
    const requestId = ++previewRequestRef.current;
    setPreviewLoading(true);
    const timeout = setTimeout(async () => {
      try {
        const blob = await api.previewEventCard(token, {
          title: form.title.trim(),
          payload: formToPayload(form),
        });
        if (requestId !== previewRequestRef.current) return; // устарел, пока летел запрос
        const url = URL.createObjectURL(blob);
        setPreviewUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return url;
        });
      } catch {
        // тихо игнорируем — предпросмотр вспомогательный, не должен мешать заполнению формы
      } finally {
        if (requestId === previewRequestRef.current) setPreviewLoading(false);
      }
    }, 700);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, token]);

  const previewUrlRef = useRef(previewUrl);
  previewUrlRef.current = previewUrl;
  useEffect(() => () => previewUrlRef.current && URL.revokeObjectURL(previewUrlRef.current), []);

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

      <TasksField
        tasks={form.tasks}
        onChange={(tasks) => setForm((f) => ({ ...f, tasks }))}
        label="Задача"
        addLabel="+ Задача"
      />
      <TasksField
        tasks={form.extraTasks}
        onChange={(extraTasks) => setForm((f) => ({ ...f, extraTasks }))}
        label="Доп. задача"
        addLabel="+ Доп. задача"
      />

      <label>
        Угрозы и вражеские силы
        <input type="text" value={form.threat} onChange={(e) => setForm((f) => ({ ...f, threat: e.target.value }))} />
      </label>
      <label>
        Начало брифинга
        <DateTimePicker
          value={form.briefing_start}
          onChange={(v) => setForm((f) => ({ ...f, briefing_start: v }))}
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
        <span className="hint-text"> Часто узнаётся только по ходу брифинга — можно оставить пустым и дозаполнить позже, даже после одобрения.</span>
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

      <MapImageField value={form.map_image_url} onChange={(url) => setForm((f) => ({ ...f, map_image_url: url }))} />

      {error && <p className="error-text">{error}</p>}

      <div className="regiment-panel">
        <h4>
          Предпросмотр карточки {previewLoading && <span className="hint-text">— обновляется…</span>}
        </h4>
        {previewUrl ? (
          <img src={previewUrl} alt="Предпросмотр карточки" style={{ maxWidth: "100%", borderRadius: 8 }} />
        ) : (
          <p className="hint-text">Заполните название операции — карточка появится здесь автоматически.</p>
        )}
      </div>

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

/** Кнопка "Показать карточку" — подгружает и раскрывает полную карточку-досье
 * уже сохранённой заявки (см. решение пользователя: посмотреть полностью то,
 * что уже было одобрено/подано). */
function CardViewButton({ eventId }) {
  const { token } = useAuth();
  const [imageUrl, setImageUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => () => imageUrl && URL.revokeObjectURL(imageUrl), [imageUrl]);

  async function toggle() {
    if (imageUrl) {
      setImageUrl(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const blob = await api.getEventCard(token, eventId);
      setImageUrl(URL.createObjectURL(blob));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button type="button" onClick={toggle} disabled={loading}>
        {loading ? "Загрузка…" : imageUrl ? "Скрыть карточку" : "Показать карточку"}
      </button>
      {error && <p className="error-text">{error}</p>}
      {imageUrl && (
        <div className="regiment-panel">
          <img src={imageUrl} alt="Карточка операции" style={{ maxWidth: "100%", borderRadius: 8 }} />
        </div>
      )}
    </>
  );
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

function RosterPanel() {
  const { token } = useAuth();
  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getEventRoster(token).then(setRoster).catch(() => setRoster([])).finally(() => setLoading(false));
  }, [token]);

  if (loading) return <InlineSpinner />;

  return (
    <div className="regiment-panel">
      <h3>Состав Ивентрума</h3>
      {roster.length === 0 ? (
        <EmptyState text="Роли Ивентрума ещё не настроены или никто их не занимает." />
      ) : (
        <table className="roster-table roster-table-wide">
          <thead>
            <tr>
              <th>Участник</th>
              <th>Роль</th>
              <th>Подано</th>
              <th>Одобрено</th>
              <th>Отклонено</th>
            </tr>
          </thead>
          <tbody>
            {roster.map((r) => (
              <tr key={r.discord_id}>
                <td>{r.username}</td>
                <td>{ROLE_LABELS[r.role] || r.role}</td>
                <td>{r.submitted_count}</td>
                <td>{r.approved_count}</td>
                <td>{r.rejected_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Ивентрум — независимая от Рапортов/Инструкторской сущность: Ивентолог (а
 * также Ассистент/Куратор/создатель) подаёт заявку на ивент, Ассистент/Куратор
 * ивентологии одобряют (при одобрении бот шлёт карточку операции в Discord).
 * Многие поля (например, командующего) часто узнают только по ходу брифинга —
 * заявку можно редактировать и до, и после одобрения (см. решение пользователя). */
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
        Заявки на ивенты — одобряет Ассистент/Куратор ивентологии, при одобрении бот отправляет карточку операции в
        Discord. Заявку можно дозаполнять и после одобрения — тогда в канал уйдёт обновлённая карточка.
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
                    <CardViewButton eventId={ev.id} />
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
                <div className="report-row-actions">
                  <CardViewButton eventId={ev.id} />
                  {(ev.status === "pending" || ev.status === "approved") && (
                    <button type="button" onClick={() => setEditingId(ev.id)}>
                      {ev.status === "approved" ? "Дозаполнить" : "Редактировать"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {canDecide && <RosterPanel />}
    </div>
  );
}
