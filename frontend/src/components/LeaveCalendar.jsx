import { useMemo, useState } from "react";
import { formatFullName } from "../utils/formatName";

const MONTH_NAMES = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];
const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function toDateOnly(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function buildMonthGrid(year, month) {
  const first = new Date(year, month, 1);
  // Понедельник = 0 ... воскресенье = 6
  const firstWeekday = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(new Date(year, month, day));
  return cells;
}

/** Календарь отпусков на месяц — approved-заявки показываются точкой на каждом
 * дне их диапазона; клик по дню показывает, кто в отпуске в этот день. */
export function LeaveCalendar({ requests }) {
  const today = toDateOnly(new Date());
  const [viewDate, setViewDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDay, setSelectedDay] = useState(null);

  const approved = useMemo(
    () =>
      requests
        .filter((r) => r.status === "approved")
        .map((r) => ({ ...r, start: new Date(r.start_date), end: new Date(r.end_date) })),
    [requests]
  );

  const cells = useMemo(() => buildMonthGrid(viewDate.getFullYear(), viewDate.getMonth()), [viewDate]);

  function onLeaveThisDay(day) {
    if (!day) return [];
    return approved.filter((r) => day >= toDateOnly(r.start) && day <= toDateOnly(r.end));
  }

  function changeMonth(delta) {
    setSelectedDay(null);
    setViewDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  }

  const selectedEntries = selectedDay ? onLeaveThisDay(selectedDay) : [];

  return (
    <div className="leave-calendar regiment-panel fade-in-up">
      <div className="leave-calendar-header">
        <button type="button" className="ghost" onClick={() => changeMonth(-1)}>
          ←
        </button>
        <strong>
          {MONTH_NAMES[viewDate.getMonth()]} {viewDate.getFullYear()}
        </strong>
        <button type="button" className="ghost" onClick={() => changeMonth(1)}>
          →
        </button>
      </div>

      <div className="leave-calendar-grid">
        {WEEKDAY_LABELS.map((w) => (
          <div key={w} className="leave-calendar-weekday">
            {w}
          </div>
        ))}
        {cells.map((day, i) => {
          const entries = onLeaveThisDay(day);
          const isToday = day && day.getTime() === today.getTime();
          const isSelected = day && selectedDay && day.getTime() === selectedDay.getTime();
          return (
            <button
              type="button"
              key={i}
              className={`leave-calendar-day ${isToday ? "leave-calendar-day-today" : ""} ${
                isSelected ? "leave-calendar-day-selected" : ""
              }`}
              disabled={!day}
              onClick={() => setSelectedDay(day)}
            >
              {day && <span>{day.getDate()}</span>}
              {entries.length > 0 && <span className="leave-calendar-dot" />}
            </button>
          );
        })}
      </div>

      {selectedDay && (
        <div className="leave-calendar-details">
          <p className="hint-text">
            {selectedDay.toLocaleDateString("ru-RU")}
            {selectedEntries.length === 0 ? " — никто не в отпуске" : ":"}
          </p>
          {selectedEntries.map((r) => (
            <p key={r.id}>{formatFullName(r.user)}</p>
          ))}
        </div>
      )}
    </div>
  );
}
