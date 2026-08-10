import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "./ToastContext";
import { formatMskDate } from "../utils/formatDate";

const STATUS_LABELS = { pending: "ожидает", approved: "одобрено", rejected: "отклонено" };
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
function toLocalInputValue(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Календарь бронирования дат/времени под ивенты — до проведения слот нужно
 * забронировать, одобряет Ассистент/Куратор ивентологии (см. решение
 * пользователя), чтобы брони не пересекались. */
export function EventBookingCalendar() {
  const { token, access } = useAuth();
  const showToast = useToast();
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [bookings, setBookings] = useState([]);
  const [error, setError] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);
  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function load() {
    const rangeStart = startOfMonth(month);
    const rangeEnd = startOfNextMonth(month);
    api
      .listEventBookings(token, { rangeStart: rangeStart.toISOString(), rangeEnd: rangeEnd.toISOString() })
      .then(setBookings)
      .catch((e) => setError(e.message));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, month]);

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
    setStartsAt(toLocalInputValue(start));
    setEndsAt(toLocalInputValue(end));
    setTitle("");
  }

  async function handleSubmitBooking(e) {
    e.preventDefault();
    if (!title.trim() || !startsAt || !endsAt) return;
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

      <table className="roster-table event-booking-calendar">
        <thead>
          <tr>
            {WEEKDAYS.map((w) => (
              <th key={w}>{w}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, i) => (
            <tr key={i}>
              {week.map((day) => {
                const key = toDateKey(day);
                const inMonth = day.getMonth() === month.getMonth();
                const dayBookings = bookingsByDateKey.get(key) || [];
                return (
                  <td
                    key={key}
                    className="clickable-row"
                    style={{ opacity: inMonth ? 1 : 0.4, cursor: "pointer", verticalAlign: "top" }}
                    onClick={() => openBookingForm(day)}
                  >
                    <div className={key === today ? "hint-text" : undefined}>{day.getDate()}</div>
                    {dayBookings.map((b) => (
                      <div key={b.id} className={`status-badge status-${b.status}`} style={{ display: "block", marginTop: "0.2rem" }}>
                        {b.title} ({STATUS_LABELS[b.status]})
                      </div>
                    ))}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {selectedDate && (
        <form className="report-form fade-in-up" onSubmit={handleSubmitBooking}>
          <h4>Забронировать {formatMskDate(selectedDate)}</h4>
          <label>
            Название ивента
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label>
            Начало
            <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </label>
          <label>
            Окончание
            <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </label>
          <div className="report-form-actions">
            <button className="primary" type="submit" disabled={submitting}>
              Забронировать
            </button>
            <button className="ghost" type="button" onClick={() => setSelectedDate(null)}>
              Отмена
            </button>
          </div>
        </form>
      )}

      {access?.can_decide_event && bookings.some((b) => b.status === "pending") && (
        <>
          <h4>Ожидают решения</h4>
          <ul className="member-report-list">
            {bookings
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
    </>
  );
}
