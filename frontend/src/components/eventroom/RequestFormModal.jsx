import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { formatMskDate } from "../../utils/formatDate";
import { DateTimePicker } from "../DateTimePicker";
import { MemberSearchPicker } from "../MemberSearchPicker";
import { AudienceField, MapImageField, TasksField, toPickerValue } from "./fields";
import { KINDS, KIND_ORDER, emptyForm, eventToForm, formIsValid, formToBody, formatMini, kindOf } from "./requestModel";

/** Окно подачи/правки заявки. Новая — сначала выбор из трёх типов, потом
 * шаблон этого типа; правка открывается сразу на шаблоне (тип не меняется). */
export function RequestFormModal({ editing, maps, regiments, members, onClose, onSaved }) {
  const { token } = useAuth();
  const [kind, setKind] = useState(editing ? kindOf(editing) : null);
  const [form, setForm] = useState(() => (editing ? eventToForm(editing) : null));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function pick(k) {
    setKind(k);
    setForm(emptyForm(k));
  }

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const valid = kind && form && formIsValid(kind, form);

  async function submit(e) {
    e.preventDefault();
    if (!valid) return;
    setSubmitting(true);
    setError(null);
    try {
      const body = formToBody(kind, form);
      if (editing) await api.updateEvent(token, editing.id, { title: body.title, payload: body.payload });
      else await api.createEvent(token, body);
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const resubmit = editing && editing.status === "revision";

  return createPortal(
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal request-modal" role="dialog" aria-label="Заявка Ивентрума">
        <button type="button" className="modal-close" onClick={onClose} aria-label="Закрыть">
          ×
        </button>
        {!kind ? (
          <>
            <h3>Новая заявка</h3>
            <p className="hint-text">Выберите, что подаёте. Заявку одобряет Ассистент или Куратор ивентологии, после одобрения вы сами отправляете её в Discord.</p>
            <div className="request-kinds">
              {KIND_ORDER.map((k) => (
                <button key={k} type="button" className="request-kind" onClick={() => pick(k)}>
                  <span className={`request-kind-badge kind-${k}`}>{KINDS[k].short}</span>
                  <b>{KINDS[k].label}</b>
                  <span>{KINDS[k].hint}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <form onSubmit={submit} className="request-form">
            <h3>
              <span className={`request-kind-badge kind-${kind}`}>{KINDS[kind].short}</span>{" "}
              {editing ? `Правка: ${editing.title}` : KINDS[kind].label}
            </h3>
            {resubmit && editing.revision_comment && (
              <p className="request-revision-note">
                <b>Что поправить:</b> {editing.revision_comment}
              </p>
            )}
            {!editing && (
              <button type="button" className="ghost request-back" onClick={() => setKind(null)}>
                ← другой тип
              </button>
            )}

            {kind === "mini" && <MiniFields form={form} set={set} />}
            {kind === "rp" && <RpFields form={form} set={set} regiments={regiments} members={members} />}
            {kind === "event" && (
              <OperationFields form={form} set={set} maps={maps} regiments={regiments} members={members} />
            )}

            {error && <p className="error-text">{error}</p>}
            <div className="modal-actions">
              <button className="ghost" type="button" onClick={onClose}>
                Отмена
              </button>
              <button className="primary" type="submit" disabled={!valid || submitting}>
                {submitting ? "Сохранение…" : editing ? (resubmit ? "Исправить и отправить на рассмотрение" : "Сохранить") : "Подать заявку"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}

/* ---------- шаблоны ---------- */

function Field({ label, hint, children, wide }) {
  return (
    <label className={wide ? "request-field wide" : "request-field"}>
      <span className="request-field-label">{label}</span>
      {hint && <span className="hint-text">{hint}</span>}
      {children}
    </label>
  );
}

function Section({ title, children }) {
  return (
    <fieldset className="request-section">
      <legend>{title}</legend>
      <div className="request-grid">{children}</div>
    </fieldset>
  );
}

function MiniFields({ form, set }) {
  return (
    <>
      <Section title="Сообщение">
        <Field label="От кого">
          <input value={form.sender} maxLength={200} placeholder="Адмирала флота 11-ой секторальной армии" onChange={(e) => set({ sender: e.target.value })} />
        </Field>
        <Field label="Кому">
          <input value={form.recipient} maxLength={200} placeholder="Регулярным силам 11-ой секторальной армии" onChange={(e) => set({ recipient: e.target.value })} />
        </Field>
        <Field label="Текст сообщения" wide>
          <textarea rows={4} value={form.message} maxLength={1500} onChange={(e) => set({ message: e.target.value })} />
        </Field>
        <Field label="Время">
          <input value={form.time} maxLength={60} onChange={(e) => set({ time: e.target.value })} />
        </Field>
        <Field label="Название в списке" hint="Необязательно — по умолчанию «Сообщение от …»">
          <input value={form.title} maxLength={255} onChange={(e) => set({ title: e.target.value })} />
        </Field>
      </Section>
      <div className="request-preview">
        <span className="request-field-label">Так это увидят в Discord</span>
        <pre className="comms-preview">{formatMini(formToBody("mini", form).payload)}</pre>
      </div>
    </>
  );
}

function BookingPicker({ form, set }) {
  const { token } = useAuth();
  const [bookings, setBookings] = useState([]);
  useEffect(() => {
    api.listMyEventBookings(token).then(setBookings).catch(() => setBookings([]));
  }, [token]);
  if (!bookings.length) return null;
  return (
    <Field label="Моя бронь" hint="Подставит время начала">
      <select
        value={form.booking_id}
        onChange={(e) => {
          const b = bookings.find((x) => String(x.id) === e.target.value);
          set({ booking_id: e.target.value, briefing_start: b ? toPickerValue(new Date(b.starts_at)) : form.briefing_start });
        }}
      >
        <option value="">— не выбрано —</option>
        {bookings.map((b) => (
          <option key={b.id} value={b.id}>
            {formatMskDate(b.starts_at)} МСК — {b.title}
          </option>
        ))}
      </select>
    </Field>
  );
}

function RpFields({ form, set, regiments, members }) {
  return (
    <>
      <Section title="Основное">
        <Field label="Название" wide>
          <input value={form.title} maxLength={255} onChange={(e) => set({ title: e.target.value })} />
        </Field>
        <Field label="Сюжет: что происходит" wide>
          <textarea rows={4} value={form.summary} onChange={(e) => set({ summary: e.target.value })} />
        </Field>
      </Section>
      <Section title="Где и когда">
        <BookingPicker form={form} set={set} />
        <Field label="Начало">
          <DateTimePicker value={form.briefing_start} onChange={(v) => set({ briefing_start: v })} />
        </Field>
        <Field label="Место (планета, локация)">
          <input value={form.planet_name} onChange={(e) => set({ planet_name: e.target.value })} />
        </Field>
      </Section>
      <Section title="Кто участвует">
        <div className="request-field wide">
          <AudienceField label="Участники" value={form.participants} onChange={(v) => set({ participants: v })} regiments={regiments} members={members} />
        </div>
        <Field label="Дополнительно" wide>
          <textarea rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
        </Field>
      </Section>
    </>
  );
}

function OperationFields({ form, set, maps, regiments, members }) {
  const { token } = useAuth();
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState(null);

  useEffect(() => () => previewUrl && URL.revokeObjectURL(previewUrl), [previewUrl]);

  async function preview() {
    setPreviewing(true);
    setPreviewError(null);
    try {
      const body = formToBody("event", form);
      const blob = await api.previewEventCard(token, { title: body.title || "Без названия", payload: body.payload });
      setPreviewUrl(URL.createObjectURL(blob));
    } catch (e) {
      setPreviewError(e.message);
    } finally {
      setPreviewing(false);
    }
  }

  return (
    <>
      <Section title="Операция">
        <Field label="Название операции" wide>
          <input value={form.title} maxLength={255} onChange={(e) => set({ title: e.target.value })} />
        </Field>
        <Field label="Сводка" wide>
          <textarea rows={3} value={form.summary} onChange={(e) => set({ summary: e.target.value })} />
        </Field>
        <Field label="Цель" wide>
          <input value={form.objective} onChange={(e) => set({ objective: e.target.value })} />
        </Field>
        <div className="request-field">
          <TasksField tasks={form.tasks} onChange={(tasks) => set({ tasks })} label="Задача" addLabel="+ Задача" />
        </div>
        <div className="request-field">
          <TasksField tasks={form.extraTasks} onChange={(extraTasks) => set({ extraTasks })} label="Доп. задача" addLabel="+ Доп. задача" />
        </div>
        <Field label="Угрозы и вражеские силы" wide>
          <input value={form.threat} onChange={(e) => set({ threat: e.target.value })} />
        </Field>
      </Section>

      <Section title="Время и состав">
        <BookingPicker form={form} set={set} />
        <Field label="Начало брифинга">
          <DateTimePicker value={form.briefing_start} onChange={(v) => set({ briefing_start: v })} />
        </Field>
        <Field label="Командующий" hint="Можно дописать позже">
          <MemberSearchPicker members={members} selectedId={form.commander_discord_id} onSelect={(id) => set({ commander_discord_id: id })} />
        </Field>
        <div className="request-field">
          <AudienceField label="Участвующий состав" value={form.participants} onChange={(v) => set({ participants: v })} regiments={regiments} members={members} />
        </div>
        <div className="request-field">
          <AudienceField label="Приписной состав" value={form.attached} onChange={(v) => set({ attached: v })} regiments={regiments} members={members} />
        </div>
      </Section>

      <Section title="Место">
        <Field label="Карта">
          <select value={form.map_id} onChange={(e) => set({ map_id: e.target.value })}>
            <option value="">— без карты —</option>
            {maps.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="request-field">
          <MapImageField value={form.map_image_url} onChange={(url) => set({ map_image_url: url })} />
        </div>
        <Field label="Планета">
          <input value={form.planet_name} onChange={(e) => set({ planet_name: e.target.value })} />
        </Field>
        <Field label="Ландшафт">
          <input value={form.landscape} onChange={(e) => set({ landscape: e.target.value })} />
        </Field>
        <Field label="Погода">
          <input value={form.weather} onChange={(e) => set({ weather: e.target.value })} />
        </Field>
        <Field label="Флора и фауна">
          <input value={form.flora_fauna} onChange={(e) => set({ flora_fauna: e.target.value })} />
        </Field>
      </Section>

      <div className="request-preview">
        <button type="button" className="ghost" onClick={preview} disabled={previewing || !form.title.trim()}>
          {previewing ? "Рисую карточку…" : previewUrl ? "Обновить предпросмотр карточки" : "Предпросмотр карточки"}
        </button>
        {previewError && <p className="error-text">{previewError}</p>}
        {previewUrl && <img src={previewUrl} alt="Предпросмотр карточки" className="request-card-img" />}
      </div>
    </>
  );
}
