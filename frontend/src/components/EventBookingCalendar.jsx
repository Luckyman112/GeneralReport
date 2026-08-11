import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { ConfirmDialog } from "./ConfirmDialog";
import { DateTimePicker } from "./DateTimePicker";
import { useToast } from "./ToastContext";
import { formatMskDate } from "../utils/formatDate";

const STATUS_LABELS = { pending: "ожидает", approved: "одобрено", rejected: "отклонено" };
const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTH_NAMES = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

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
  return `${d.getDate()} ${MONTH_NAMES[d.getMonth()].toLowerCase()} ${d.getFullYear()}`;
}

/** Календарь бронирования дат/времени под ивенты — до проведения слот нужно
 * забронировать, одобряет Ассистент/Куратор ивентологии (см. решение
 * пользователя), чтобы брони не пересекались. */
export function EventBookingCalendar() {
  const { token, user, access } = useAuth();
  const showToast = useToast();
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [bookings, setBookings] = useState([]);
  // Отдельно от bookings (та привязана к текущему отображаемому месяцу
  // календаря) — широкое окно на год вперёд, НЕ зависящее от того, какой
  // месяц сейчас пролистан. Без этого "Ожидают решения"/"Одобренные брони"/
  // "Мои брони" были видны только если решающий/автор случайно смотрели тот
  // же месяц, что и дата брони — баг-репорт: бронь "не видна" ни автору, ни
  // Асику+, хотя реально была создана (просто в другом месяце).
  const [upcomingBookings, setUpcomingBookings] = useState([]);
  const [error, setError] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [confirmCancelId, setConfirmCancelId] = useState(null);

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
      showToast("Бронь отправлена на одобрение");
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

  async function handleDecide(bookingId, status) {
    try {
      await api.decideEventBooking(token, bookingId, { status });
      showToast(status === "approved" ? "Бронь одобрена" : "Бронь отклонена");
      load();
      loadUpcoming();
    } catch (e) {
      showToast(e.message, "error");
    }
  }

  async function handleCancel(bookingId) {
    try {
      await api.cancelEventBooking(token, bookingId);
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
                        title={`${b.title} (${STATUS_LABELS[b.status]})`}
                      >
                        {b.title}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

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
                  {b.status === "rejected" && b.rejection_reason && (
                    <p className="report-rejection-reason">Причина отклонения: {b.rejection_reason}</p>
                  )}
                </li>
              ))}
          </ul>
        </>
      )}

      {access?.can_decide_event && upcomingBookings.some((b) => b.status === "pending") && (
        <>
          <h4>Ожидают решения</h4>
          <ul className="member-report-list">
            {upcomingBookings
              .filter((b) => b.status === "pending")
              .map((b) => (
                <li key={b.id}>
                  <span className="member-report-date">
                    {formatMskDate(b.starts_at)} — {formatMskDate(b.ends_at)} МСК
                  </span>
                  <p className="member-report-content">
                    {b.title} — запросил {b.requested_by?.nickname_override || b.requested_by?.username}
                  </p>
                  <div className="report-form-actions">
                    <button type="button" onClick={() => handleDecide(b.id, "approved")}>
                      Одобрить
                    </button>
                    <button type="button" className="ghost error-text" onClick={() => handleDecide(b.id, "rejected")}>
                      Отклонить
                    </button>
                  </div>
                </li>
              ))}
          </ul>
        </>
      )}

      {access?.can_decide_event && upcomingBookings.some((b) => b.status === "approved") && (
        <>
          <h4>Одобренные брони</h4>
          <ul className="member-report-list">
            {upcomingBookings
              .filter((b) => b.status === "approved")
              .map((b) => (
                <li key={b.id}>
                  <span className="member-report-date">
                    {formatMskDate(b.starts_at)} — {formatMskDate(b.ends_at)} МСК
                  </span>
                  <p className="member-report-content">
                    {b.title} — {b.requested_by?.nickname_override || b.requested_by?.username}
                  </p>
                  <div className="report-form-actions">
                    <button type="button" className="ghost error-text" onClick={() => setConfirmCancelId(b.id)}>
                      Отменить
                    </button>
                  </div>
                </li>
              ))}
          </ul>
        </>
      )}

      <ConfirmDialog
        open={confirmCancelId !== null}
        message="Отменить эту одобренную бронь? Слот снова станет свободным."
        confirmLabel="Отменить бронь"
        onConfirm={() => handleCancel(confirmCancelId)}
        onCancel={() => setConfirmCancelId(null)}
      />
    </>
  );
}
