import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { ConfirmDialog } from "./ConfirmDialog";
import { DateTimePicker } from "./DateTimePicker";
import { useToast } from "./ToastContext";
import { formatMskDate } from "../utils/formatDate";

// rejected у брони = отменена (отдельного статуса нет, см. app/crud/event_booking.py::cancel)
const STATUS_LABELS = { pending: "ожидает", approved: "действует", rejected: "отменена" };

function hhmm(iso) {
  return new Date(iso).toLocaleTimeString("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" });
}
function who(u) {
  return u ? u.nickname_override || u.username : "—";
}
const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function startOfNextMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 1);
}
function toDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
// Формат, который понимает DateTimePicker (совпадает со старым datetime-local)
function toPickerValue(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function formatDayLabel(d) {
  // toLocaleDateString даёт родительный падеж: «8 октября 2026», а не «8 октябрь»
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" }).replace(" г.", "");
}

/** Календарь бронирования дат/времени под ивенты — бронь занимает слот сразу,
 * без отдельного одобрения (см. решение пользователя, отдельный шаг решения
 * убран); overlap-check на сервере не даёт двум ивентологам забронировать
 * пересекающееся время. */
export function EventBookingCalendar() {
  const { token, user, access } = useAuth();
  const showToast = useToast();
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [bookings, setBookings] = useState([]);
  // Отдельно от bookings (та привязана к текущему отображаемому месяцу
  // календаря) — широкое окно на год вперёд, НЕ зависящее от того, какой
  // месяц сейчас пролистан. Без этого "Одобренные брони"/"Мои брони" были
  // видны только если смотрящий случайно открыл тот же месяц, что и дата
  // брони — баг-репорт: бронь "не видна", хотя реально была создана (просто
  // в другом месяце).
  const [upcomingBookings, setUpcomingBookings] = useState([]);
  const [error, setError] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmCancelId, setConfirmCancelId] = useState(null);
  const [cancelReason, setCancelReason] = useState("");

  function load() {
    const rangeStart = startOfMonth(month);
    const rangeEnd = startOfNextMonth(month);
    api
      .listEventBookings(token, { rangeStart: rangeStart.toISOString(), rangeEnd: rangeEnd.toISOString() })
      .then(setBookings)
      .catch((e) => setError(e.message));
  }

  function loadUpcoming() {
    const rangeStart = new Date();
    rangeStart.setDate(rangeStart.getDate() - 7);
    const rangeEnd = new Date();
    rangeEnd.setFullYear(rangeEnd.getFullYear() + 1);
    api
      .listEventBookings(token, { rangeStart: rangeStart.toISOString(), rangeEnd: rangeEnd.toISOString() })
      .then(setUpcomingBookings)
      .catch((e) => setError(e.message));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, month]);

  useEffect(() => {
    loadUpcoming();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const bookingsByDateKey = useMemo(() => {
    const map = new Map();
    for (const b of bookings) {
      const key = toDateKey(new Date(b.starts_at));
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(b);
    }
    return map;
  }, [bookings]);

  const weeks = useMemo(() => {
    const first = startOfMonth(month);
    const gridStart = new Date(first);
    // Пн=1..Вс=7 -> сдвиг до понедельника недели, в которой лежит 1-е число
    const jsWeekday = first.getDay() === 0 ? 7 : first.getDay();
    gridStart.setDate(first.getDate() - (jsWeekday - 1));
    const days = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      days.push(d);
    }
    const result = [];
    for (let i = 0; i < days.length; i += 7) result.push(days.slice(i, i + 7));
    return result;
  }, [month]);

  function openBookingForm(date) {
    setSelectedDate(date);
    const start = new Date(date);
    start.setHours(18, 0, 0, 0);
    const end = new Date(start);
    end.setHours(start.getHours() + 2);
    setStartsAt(toPickerValue(start));
    setEndsAt(toPickerValue(end));
    setTitle("");
  }

  // Начало и окончание — независимые поля, но пользователь двигает именно
  // начало (например с дефолтных 18:00 на 21:00) — без этого окончание
  // осталось бы на старом месте (20:00) и бронь падала с "Время окончания
  // должно быть позже времени начала", хотя внешне ничего не подсказывало,
  // что окончание тоже надо было подвинуть. Сдвигаем окончание на ту же
  // разницу, сохраняя текущую длительность брони.
  function handleStartChange(nextStartsAt) {
    const prevStart = startsAt ? new Date(startsAt) : null;
    const prevEnd = endsAt ? new Date(endsAt) : null;
    setStartsAt(nextStartsAt);
    if (!nextStartsAt || !prevStart || !prevEnd) return;
    const durationMs = prevEnd.getTime() - prevStart.getTime();
    if (durationMs <= 0) return;
    const nextStart = new Date(nextStartsAt);
    setEndsAt(toPickerValue(new Date(nextStart.getTime() + durationMs)));
  }

  const isTimeRangeValid = Boolean(startsAt && endsAt && new Date(endsAt) > new Date(startsAt));

  async function handleSubmitBooking(e) {
    e.preventDefault();
    if (!title.trim() || !isTimeRangeValid) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.createEventBooking(token, {
        title: title.trim(),
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
      });
      showToast("Время забронировано");
      setSelectedDate(null);
      load();
      loadUpcoming();
    } catch (err) {
      setError(err.message);
      showToast(err.message, "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleApprove(bookingId) {
    try {
      await api.approveEventBooking(token, bookingId);
      showToast("Бронь снова действует");
      load();
      loadUpcoming();
    } catch (e) {
      showToast(e.message, "error");
    }
  }

  async function handleCancel(bookingId, reason) {
    try {
      await api.cancelEventBooking(token, bookingId, reason);
      showToast("Бронь отменена");
      setConfirmCancelId(null);
      load();
      loadUpcoming();
    } catch (e) {
      showToast(e.message, "error");
    }
  }

  if (!access?.is_event_submitter) return null;

  const today = toDateKey(new Date());

  return (
    <>
      <h3>Календарь броней</h3>
      {error && <p className="error-text">{error}</p>}
      <div className="report-form-actions">
        <button type="button" className="ghost" onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}>
          ← Пред. месяц
        </button>
        <span className="hint-text">{month.toLocaleString("ru-RU", { month: "long", year: "numeric" })}</span>
        <button type="button" className="ghost" onClick={() => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}>
          След. месяц →
        </button>
      </div>

      <div className="booking-calendar-weekdays">
        {WEEKDAYS.map((w) => (
          <div key={w} className="booking-calendar-weekday">{w}</div>
        ))}
      </div>
      <div className="booking-calendar-grid">
        {weeks.flatMap((week) =>
          week.map((day) => {
            const key = toDateKey(day);
            const inMonth = day.getMonth() === month.getMonth();
            const dayBookings = bookingsByDateKey.get(key) || [];
            return (
              <div
                key={key}
                className={[
                  "booking-calendar-day",
                  !inMonth && "booking-calendar-day-outside",
                  key === today && "booking-calendar-day-today",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => openBookingForm(day)}
              >
                <span className="booking-calendar-daynum">{day.getDate()}</span>
                {dayBookings.length > 0 && (
                  <div className="booking-calendar-chips">
                    {dayBookings.map((b) => (
                      <span
                        key={b.id}
                        className={`booking-calendar-chip booking-calendar-chip-${b.status}`}
                        title={`${hhmm(b.starts_at)}–${hhmm(b.ends_at)} МСК · ${b.title} · ${who(b.requested_by)} · ${STATUS_LABELS[b.status]}${b.status === "rejected" && b.rejection_reason ? ` (${b.rejection_reason})` : ""}`}
                      >
                        {hhmm(b.starts_at)} {b.title}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {selectedDate && (bookingsByDateKey.get(toDateKey(selectedDate)) || []).length > 0 && (
        <div className="booking-day-panel fade-in-up">
          <h4>Брони на {formatDayLabel(selectedDate)}</h4>
          <ul className="booking-day-list">
            {(bookingsByDateKey.get(toDateKey(selectedDate)) || []).map((b) => (
              <li key={b.id} className={`booking-day-item status-${b.status}`}>
                <span className="booking-day-time">
                  {hhmm(b.starts_at)}–{hhmm(b.ends_at)} МСК
                </span>
                <span className="booking-day-title">{b.title}</span>
                <span className="hint-text">забронировал {who(b.requested_by)}</span>
                <span className={`status-badge status-${b.status}`}>{STATUS_LABELS[b.status]}</span>
                {b.status === "rejected" && (
                  <span className="report-rejection-reason">
                    Отменил {who(b.decided_by)}
                    {b.decided_at ? ` ${formatMskDate(b.decided_at)} МСК` : ""}
                    {b.rejection_reason ? `: ${b.rejection_reason}` : ""}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {selectedDate && (
        <form className="report-form fade-in-up" onSubmit={handleSubmitBooking}>
          <h4>Забронировать {formatDayLabel(selectedDate)}</h4>
          <label>
            Название ивента
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label>
            Начало
            <DateTimePicker value={startsAt} onChange={handleStartChange} />
          </label>
          <label>
            Окончание
            <DateTimePicker value={endsAt} onChange={setEndsAt} />
          </label>
          {!isTimeRangeValid && (
            <p className="error-text">Время окончания должно быть позже времени начала</p>
          )}
          <div className="report-form-actions">
            <button className="primary" type="submit" disabled={submitting || !title.trim() || !isTimeRangeValid}>
              Забронировать
            </button>
            <button className="ghost" type="button" onClick={() => setSelectedDate(null)}>
              Отмена
            </button>
          </div>
        </form>
      )}

      {!access?.can_decide_event && upcomingBookings.some((b) => b.requested_by?.id === user.id) && (
        <>
          <h4>Мои брони</h4>
          <ul className="member-report-list">
            {upcomingBookings
              .filter((b) => b.requested_by?.id === user.id)
              .map((b) => (
                <li key={b.id}>
                  <span className="member-report-date">
                    {formatMskDate(b.starts_at)} — {formatMskDate(b.ends_at)} МСК
                  </span>
                  <p className="member-report-content">
                    {b.title} — <span className={`status-badge status-${b.status}`}>{STATUS_LABELS[b.status]}</span>
                  </p>
                  {b.status === "rejected" && (
                    <p className="report-rejection-reason">
                      Отменил {who(b.decided_by)}{b.rejection_reason ? `: ${b.rejection_reason}` : ""}
                    </p>
                  )}
                </li>
              ))}
          </ul>
        </>
      )}

      {access?.can_decide_event && upcomingBookings.some((b) => new Date(b.ends_at) > new Date()) && (
        <>
          <h4>Брони ивентологов</h4>
          <p className="hint-text">
            Ивент отменили или перенесли — отмените бронь, слот освободится. Отменённую бронь можно вернуть, если
            время ещё свободно.
          </p>
          <ul className="member-report-list">
            {upcomingBookings
              .filter((b) => new Date(b.ends_at) > new Date())
              .map((b) => (
                <li key={b.id}>
                  <span className="member-report-date">
                    {formatMskDate(b.starts_at)} — {formatMskDate(b.ends_at)} МСК
                  </span>
                  <p className="member-report-content">
                    {b.title} — {b.requested_by?.nickname_override || b.requested_by?.username} —{" "}
                    <span className={`status-badge status-${b.status}`}>
                      {b.status === "rejected" ? "отменено" : STATUS_LABELS[b.status]}
                    </span>
                  </p>
                  {b.status === "rejected" && b.rejection_reason && (
                    <p className="report-rejection-reason">Причина: {b.rejection_reason}</p>
                  )}
                  <div className="report-form-actions">
                    {b.status === "approved" ? (
                      <button
                        type="button"
                        className="ghost error-text"
                        onClick={() => {
                          setCancelReason("");
                          setConfirmCancelId(b.id);
                        }}
                      >
                        Отменить
                      </button>
                    ) : (
                      <button type="button" onClick={() => handleApprove(b.id)}>
                        Одобрить снова
                      </button>
                    )}
                  </div>
                </li>
              ))}
          </ul>
        </>
      )}

      <ConfirmDialog
        open={confirmCancelId !== null}
        message={
          <>
            Отменить эту бронь? Слот снова станет свободным.
            <input
              type="text"
              placeholder="Причина (необязательно): ивент перенесён, отменён…"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              style={{ width: "100%", marginTop: 10 }}
            />
          </>
        }
        confirmLabel="Отменить бронь"
        onConfirm={() => handleCancel(confirmCancelId, cancelReason.trim())}
        onCancel={() => setConfirmCancelId(null)}
      />
    </>
  );
}
