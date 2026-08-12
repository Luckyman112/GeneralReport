import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { DateTimePicker } from "../components/DateTimePicker";
import { EmptyState } from "../components/EmptyState";
import { EventActivityReports } from "../components/EventActivityReports";
import { EventBookingCalendar } from "../components/EventBookingCalendar";
import { EventMemberDetailModal } from "../components/EventMemberDetailModal";
import { HorizontalBarChart } from "../components/HorizontalBarChart";
import { InlineSpinner } from "../components/InlineSpinner";
import { MemberSearchPicker } from "../components/MemberSearchPicker";
import { formatMskDate } from "../utils/formatDate";
import { formatFullName } from "../utils/formatName";

const STATUS_LABELS = {
  pending: "Ожидает решения",
  approved: "Одобрено",
  rejected: "Отклонено",
  cancelled: "Отменено",
};

const ROLE_LABELS = {
  куратор: "Куратор",
  ассистент: "Ассистент",
  "старший ивентолог": "Старший Ивентолог",
  ивентолог: "Ивентолог",
  "младший ивентолог": "Младший Ивентолог",
};

// Один период разом двигает и колонки таблицы, и график (см. решение
// пользователя — раньше период двигал только график, таблица показывала
// фиксированные неделя/месяц/всё-время колонки одновременно)
const PERIOD_OPTIONS = [
  { key: "week", label: "Неделя", miniField: "mini_count_week", combatField: "combat_count_week" },
  { key: "month", label: "Месяц", miniField: "mini_count_month", combatField: "combat_count_month" },
  { key: "all", label: "Всё время", miniField: "mini_count_all_time", combatField: "combat_count_all_time" },
];

function emptyAudience() {
  return { mode: "role", regiment_id: null, custom_name: "", discord_ids: [] };
}

// Формат, который понимает DateTimePicker (см. его собственный formatValue) —
// нужен здесь отдельно, чтобы подставлять starts_at выбранной брони в
// "Начало брифинга" тем же форматом, что вводит сам пользователь
function toPickerValue(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
    planet_name: "",
    star_system: "",
    landscape: "",
    weather: "",
    flora_fauna: "",
    booking_id: "",
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
    planet_name: form.planet_name.trim() || null,
    star_system: form.star_system.trim() || null,
    landscape: form.landscape.trim() || null,
    weather: form.weather.trim() || null,
    flora_fauna: form.flora_fauna.trim() || null,
    booking_id: form.booking_id ? Number(form.booking_id) : null,
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
    planet_name: p.planet_name || "",
    star_system: p.star_system || "",
    landscape: p.landscape || "",
    weather: p.weather || "",
    flora_fauna: p.flora_fauna || "",
    booking_id: p.booking_id ? String(p.booking_id) : "",
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
  // Стабильные id по позиции — plain string[] не несёт identity сам по себе,
  // а index-ключ путает React при удалении задачи не с конца (инпут ниже
  // "наследует" фокус/значение соседа вместо удаления своего).
  const nextIdRef = useRef(0);
  const idsRef = useRef(tasks.map(() => nextIdRef.current++));
  if (idsRef.current.length < tasks.length) {
    while (idsRef.current.length < tasks.length) idsRef.current.push(nextIdRef.current++);
  } else if (idsRef.current.length > tasks.length) {
    idsRef.current = idsRef.current.slice(0, tasks.length);
  }

  function setTask(idx, value) {
    onChange(tasks.map((t, i) => (i === idx ? value : t)));
  }
  function addTask() {
    idsRef.current = [...idsRef.current, nextIdRef.current++];
    onChange([...tasks, ""]);
  }
  function removeTask(idx) {
    if (tasks.length > 1) {
      idsRef.current = idsRef.current.filter((_, i) => i !== idx);
      onChange(tasks.filter((_, i) => i !== idx));
    } else {
      idsRef.current = [nextIdRef.current++];
      onChange([""]);
    }
  }

  return (
    <div className="add-category-form">
      {tasks.map((t, idx) => (
        <label key={idsRef.current[idx]}>
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
  const [myBookings, setMyBookings] = useState([]);

  useEffect(() => {
    api.listMyEventBookings(token).then(setMyBookings).catch(() => setMyBookings([]));
  }, [token]);

  function handleBookingSelect(bookingId) {
    const booking = myBookings.find((b) => String(b.id) === bookingId);
    setForm((f) => ({
      ...f,
      booking_id: bookingId,
      briefing_start: booking ? toPickerValue(new Date(booking.starts_at)) : f.briefing_start,
    }));
  }

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
      {myBookings.length > 0 && (
        <label>
          Забронированное время
          <span className="hint-text"> Одобренная бронь — выбор подставит время в поле ниже.</span>
          <select value={form.booking_id} onChange={(e) => handleBookingSelect(e.target.value)}>
            <option value="">— не выбрано —</option>
            {myBookings.map((b) => (
              <option key={b.id} value={b.id}>
                {formatMskDate(b.starts_at)}–{formatMskDate(b.ends_at)} МСК — {b.title}
              </option>
            ))}
          </select>
        </label>
      )}
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

      <label>
        Название планеты
        <input
          type="text"
          value={form.planet_name}
          onChange={(e) => setForm((f) => ({ ...f, planet_name: e.target.value }))}
        />
      </label>
      <label>
        Система
        <input
          type="text"
          value={form.star_system}
          onChange={(e) => setForm((f) => ({ ...f, star_system: e.target.value }))}
        />
      </label>
      <label>
        Ландшафт
        <input
          type="text"
          value={form.landscape}
          onChange={(e) => setForm((f) => ({ ...f, landscape: e.target.value }))}
        />
      </label>
      <label>
        Погодные условия
        <input
          type="text"
          value={form.weather}
          onChange={(e) => setForm((f) => ({ ...f, weather: e.target.value }))}
        />
      </label>
      <label>
        Флора и фауна
        <input
          type="text"
          value={form.flora_fauna}
          onChange={(e) => setForm((f) => ({ ...f, flora_fauna: e.target.value }))}
        />
      </label>

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

const MESSAGE_STATUS_LABELS = {
  pending: "Ожидает решения",
  approved: "Одобрено",
  rejected: "Отклонено",
};

/** Архивная заявка — свёрнута в одну строку (название + время брифинга),
 * весь функционал (карточка/дозаполнить/отменить/сообщения) доступен по
 * клику разворачиванием, а не сразу — см. решение пользователя: архив не
 * должен выглядеть так же тяжело, как активный список. */
function ArchivedEventRow(props) {
  const { ev } = props;
  return (
    <details className="event-archive-strip">
      <summary>
        <span className="event-archive-strip-title">{ev.title}</span>
        <span className="event-archive-strip-time">{formatMskDate(ev.payload?.briefing_start)} МСК</span>
      </summary>
      <EventRow {...props} />
    </details>
  );
}

function EventRow({ ev, user, canDecide, onEdit, onCancel, onSubmitMessage, onDecideMessage, onSendMessage }) {
  return (
    <div className="report-row">
      <div className="report-row-header">
        <span className="report-regiment">{ev.title}</span>
        <span className="report-category">{STATUS_LABELS[ev.status]}</span>
      </div>
      <p className="member-report-date">{formatMskDate(ev.created_at)} МСК</p>
      {ev.status === "rejected" && ev.rejection_reason && (
        <p className="report-rejection-reason">Причина отклонения: {ev.rejection_reason}</p>
      )}
      {ev.status === "cancelled" && (
        <p className="report-rejection-reason">
          Отменено{ev.cancelled_by ? ` (${formatFullName(ev.cancelled_by)})` : ""}
          {ev.cancellation_reason ? `: ${ev.cancellation_reason}` : ""}
        </p>
      )}
      <div className="report-row-actions">
        <CardViewButton eventId={ev.id} />
        {(ev.status === "pending" || ev.status === "approved") && (
          <button type="button" onClick={onEdit}>
            {ev.status === "approved" ? "Дозаполнить" : "Редактировать"}
          </button>
        )}
        {ev.status === "approved" && canDecide && (
          <button type="button" className="ghost error-text" onClick={onCancel}>
            Отменить
          </button>
        )}
      </div>
      {ev.status === "approved" && (ev.submitted_by.id === user.id || canDecide) && (
        <EventMessagesPanel
          ev={ev}
          user={user}
          canDecide={canDecide}
          onSubmit={(content) => onSubmitMessage(ev.id, content)}
          onDecide={onDecideMessage}
          onSend={onSendMessage}
        />
      )}
    </div>
  );
}

function EventMessagesPanel({ ev, user, canDecide, onSubmit, onDecide, onSend }) {
  const [composing, setComposing] = useState(false);
  const isAuthor = ev.submitted_by.id === user.id;

  async function handleCompose(content) {
    await onSubmit(content);
    setComposing(false);
  }

  return (
    <div className="event-messages-panel">
      {ev.messages.length > 0 && (
        <ul className="member-report-list">
          {ev.messages.map((m) => (
            <li key={m.id}>
              <span className="report-category">{MESSAGE_STATUS_LABELS[m.status]}</span>
              <p className="report-row-content">{m.content}</p>
              <p className="hint-text">
                {formatMskDate(m.created_at)} МСК — {formatFullName(m.submitted_by)}
                {m.status === "rejected" && m.rejection_reason ? ` · Причина: ${m.rejection_reason}` : ""}
                {m.sent_at ? ` · Отправлено ${formatMskDate(m.sent_at)} МСК (${formatFullName(m.sent_by)})` : ""}
              </p>
              <div className="report-form-actions">
                {m.status === "pending" && canDecide && (
                  <>
                    <button type="button" onClick={() => onDecide(m.id, "approved")}>
                      Одобрить
                    </button>
                    <RejectInline onReject={(reason) => onDecide(m.id, "rejected", reason)} />
                  </>
                )}
                {m.status === "approved" && !m.sent_at && (isAuthor || canDecide) && (
                  <button type="button" className="primary" onClick={() => onSend(m.id)}>
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
          <MessageComposeForm onSubmit={handleCompose} onCancel={() => setComposing(false)} />
        ) : (
          <button type="button" onClick={() => setComposing(true)}>
            Написать сообщение
          </button>
        ))}
    </div>
  );
}

function MessageComposeForm({ onSubmit, onCancel }) {
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(content.trim());
    } catch (e) {
      setError(e.message);
      setSubmitting(false);
    }
  }

  return (
    <span className="reject-inline">
      <input
        type="text"
        placeholder="Текст сообщения"
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
      <button type="button" disabled={!content.trim() || submitting} onClick={submit}>
        {submitting ? "Подача…" : "Подать"}
      </button>
      <button type="button" className="ghost" onClick={onCancel} disabled={submitting}>
        Отмена
      </button>
      {error && <p className="error-text">{error}</p>}
    </span>
  );
}

function emptyMapForm() {
  return { id: null, name: "", url: "" };
}

function mapToForm(m) {
  return { id: m.id, name: m.name, url: m.url || "" };
}

/** Карта каталога — название+ссылка попадают в карточку операции в Discord
 * (ссылка гиперссылкой в поле "Карта"). Справка о планете переехала в саму
 * заявку на ивент (см. EventForm) — карта теперь только название+ссылка. */
function MapForm({ initial, onSubmit, onCancel }) {
  const [form, setForm] = useState(initial);

  function setField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  return (
    <div className="picker-row" style={{ flexWrap: "wrap" }}>
      <input type="text" placeholder="Название карты" value={form.name} onChange={(e) => setField("name", e.target.value)} />
      <input type="text" placeholder="Ссылка на карту" value={form.url} onChange={(e) => setField("url", e.target.value)} />
      <button type="button" disabled={!form.name.trim()} onClick={() => onSubmit(form)}>
        {form.id ? "Сохранить" : "Добавить карту"}
      </button>
      <button type="button" className="ghost" onClick={onCancel}>
        Отмена
      </button>
    </div>
  );
}

function RosterPanel() {
  const { token } = useAuth();
  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("week");
  const [selectedDiscordId, setSelectedDiscordId] = useState(null);

  useEffect(() => {
    api.getEventRoster(token).then(setRoster).catch(() => setRoster([])).finally(() => setLoading(false));
  }, [token]);

  if (loading) return <InlineSpinner />;

  const periodOption = PERIOD_OPTIONS.find((p) => p.key === period) ?? PERIOD_OPTIONS[0];
  const miniChartData = roster.map((r) => ({ id: r.discord_id, label: r.username, value: r[periodOption.miniField] ?? 0 }));
  const combatChartData = roster.map((r) => ({ id: r.discord_id, label: r.username, value: r[periodOption.combatField] ?? 0 }));

  return (
    <div className="regiment-panel">
      <h3>Состав Ивентрума</h3>
      {roster.length === 0 ? (
        <EmptyState text="Роли Ивентрума ещё не настроены или никто их не занимает." />
      ) : (
        <>
          <div className="report-form-actions">
            {PERIOD_OPTIONS.map((p) => (
              <button
                key={p.key}
                type="button"
                className={p.key === period ? "primary" : "ghost"}
                onClick={() => setPeriod(p.key)}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="roster-table-wrap-full">
            <table className="roster-table roster-table-wide roster-table-full">
              <thead>
                <tr>
                  <th>Участник</th>
                  <th>Роль</th>
                  <th>Заявок подано</th>
                  <th>Одобрено</th>
                  <th>Отклонено</th>
                  <th>Мини-ивент</th>
                  <th>Боевой вылет</th>
                  <th>Последний отчёт</th>
                </tr>
              </thead>
              <tbody>
                {roster.map((r) => (
                  <tr key={r.discord_id} onClick={() => setSelectedDiscordId(r.discord_id)}>
                    <td>{r.username}</td>
                    <td>{ROLE_LABELS[r.role] || r.role}</td>
                    <td className="mono-num">{r.submitted_count}</td>
                    <td className="mono-num">{r.approved_count}</td>
                    <td className="mono-num">{r.rejected_count}</td>
                    <td className="mono-num">{r[periodOption.miniField]}</td>
                    <td className="mono-num">{r[periodOption.combatField]}</td>
                    <td>{r.activity_last_report_at ? formatMskDate(r.activity_last_report_at) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h4>Мини-ивент за период</h4>
          <HorizontalBarChart data={miniChartData} />
          <h4>Боевой вылет за период</h4>
          <HorizontalBarChart data={combatChartData} />
        </>
      )}

      {selectedDiscordId && (
        <EventMemberDetailModal discordId={selectedDiscordId} onClose={() => setSelectedDiscordId(null)} />
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
  const { token, user, access, regiments } = useAuth();
  const [events, setEvents] = useState([]);
  const [maps, setMaps] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [mapDraft, setMapDraft] = useState(null); // null — форма закрыта, {} — создание, {id,...} — редактирование
  const [confirmCancelId, setConfirmCancelId] = useState(null);


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

  // Архив — заявки, у которых брифинг уже прошёл (см. решение пользователя);
  // без даты или в будущем — считаются актуальными
  function isArchived(ev) {
    const briefingStart = ev.payload?.briefing_start;
    if (!briefingStart) return false;
    return new Date(briefingStart).getTime() < Date.now();
  }
  const visibleEvents = canDecide ? decidedEvents : events;
  const activeEvents = useMemo(() => visibleEvents.filter((e) => !isArchived(e)), [visibleEvents]);
  const archivedEvents = useMemo(() => visibleEvents.filter((e) => isArchived(e)), [visibleEvents]);

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
    try {
      await api.approveEvent(token, id);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleReject(id, reason) {
    try {
      await api.rejectEvent(token, id, reason);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleSubmitMessage(eventId, content) {
    // без try/catch — форма (MessageComposeForm) сама ловит ошибку и показывает инлайн
    await api.createEventMessage(token, eventId, content);
    load();
  }

  async function handleDecideMessage(messageId, status, reason) {
    try {
      await api.decideEventMessage(token, messageId, { status, rejectionReason: reason });
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleSendMessage(messageId) {
    try {
      await api.sendEventMessage(token, messageId);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleCancel(id) {
    try {
      await api.cancelEvent(token, id);
      setConfirmCancelId(null);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleSaveMap(form) {
    if (!form.name.trim()) return;
    const body = { name: form.name.trim(), url: form.url.trim() };
    try {
      if (form.id) {
        await api.updateEventMap(token, form.id, body);
      } else {
        await api.createEventMap(token, body);
      }
      setMapDraft(null);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDeleteMap(id) {
    try {
      await api.deleteEventMap(token, id);
      load();
    } catch (e) {
      setError(e.message);
    }
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
                  <p className="member-report-date">{formatMskDate(ev.created_at)} МСК</p>
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
                  <button type="button" onClick={() => setMapDraft(mapToForm(m))} title="Изменить">
                    ✎
                  </button>
                  <button type="button" onClick={() => handleDeleteMap(m.id)} title="Удалить">
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          {mapDraft ? (
            <MapForm initial={mapDraft} onSubmit={handleSaveMap} onCancel={() => setMapDraft(null)} />
          ) : (
            <button type="button" className="ghost" onClick={() => setMapDraft(emptyMapForm())}>
              + Добавить карту
            </button>
          )}
        </div>
      )}

      <div className="regiment-panel">
        <h3>{canDecide ? "Все заявки" : "Мои заявки"}</h3>
        {events.length === 0 ? (
          <EmptyState text="Заявок пока нет." />
        ) : (
          <>
            <div className="report-list">
              {activeEvents.map((ev) => (
                <EventRow
                  key={ev.id}
                  ev={ev}
                  user={user}
                  canDecide={canDecide}
                  onEdit={() => setEditingId(ev.id)}
                  onCancel={() => setConfirmCancelId(ev.id)}
                  onSubmitMessage={handleSubmitMessage}
                  onDecideMessage={handleDecideMessage}
                  onSendMessage={handleSendMessage}
                />
              ))}
            </div>
            {archivedEvents.length > 0 && (
              <details className="training-spec-group">
                <summary>
                  Архив <span className="category-points-badge">{archivedEvents.length}</span>
                </summary>
                <div className="event-archive-list">
                  {archivedEvents.map((ev) => (
                    <ArchivedEventRow
                      key={ev.id}
                      ev={ev}
                      user={user}
                      canDecide={canDecide}
                      onEdit={() => setEditingId(ev.id)}
                      onCancel={() => setConfirmCancelId(ev.id)}
                      onSubmitMessage={handleSubmitMessage}
                      onDecideMessage={handleDecideMessage}
                      onSendMessage={handleSendMessage}
                    />
                  ))}
                </div>
              </details>
            )}
          </>
        )}
        <ConfirmDialog
          open={confirmCancelId !== null}
          message="Отменить эту одобренную заявку? Карточка в Discord будет отмечена «Отменено»."
          confirmLabel="Отменить заявку"
          onConfirm={() => handleCancel(confirmCancelId)}
          onCancel={() => setConfirmCancelId(null)}
        />
      </div>

      {canDecide && <RosterPanel />}

      <EventBookingCalendar />
      <EventActivityReports />
    </div>
  );
}
