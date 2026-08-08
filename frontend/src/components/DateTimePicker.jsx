import { useEffect, useRef, useState } from "react";

const MONTH_NAMES = [
  "Января", "Февраля", "Марта", "Апреля", "Мая", "Июня",
  "Июля", "Августа", "Сентября", "Октября", "Ноября", "Декабря",
];
const WEEKDAY_LABELS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function pad(n) {
  return String(n).padStart(2, "0");
}

// value/onChange используют формат "YYYY-MM-DDTHH:MM" — тот же, что раньше
// отдавал <input type="datetime-local">, бэкенд его не менял
function parseValue(value) {
  if (!value) return null;
  const [datePart, timePart] = value.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const [h, min] = (timePart || "00:00").split(":").map(Number);
  return new Date(y, m - 1, d, h, min);
}

function formatValue(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDisplay(date) {
  return `${pad(date.getDate())} ${MONTH_NAMES[date.getMonth()].toLowerCase()} ${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

/** Календарь + таймер вместо голого текстового ввода даты/времени начала
 * брифинга (см. решение пользователя). */
export function DateTimePicker({ value, onChange, placeholder = "— выбрать дату и время —" }) {
  const [open, setOpen] = useState(false);
  const selected = parseValue(value);
  const [viewYear, setViewYear] = useState((selected || new Date()).getFullYear());
  const [viewMonth, setViewMonth] = useState((selected || new Date()).getMonth());
  const [hour, setHour] = useState(selected ? selected.getHours() : 20);
  const [minute, setMinute] = useState(selected ? selected.getMinutes() : 0);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function handleOutsideClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [open]);

  function pickDay(day) {
    const date = new Date(viewYear, viewMonth, day, hour, minute);
    onChange(formatValue(date));
  }

  function applyTime(nextHour, nextMinute) {
    setHour(nextHour);
    setMinute(nextMinute);
    if (selected) {
      const date = new Date(selected.getFullYear(), selected.getMonth(), selected.getDate(), nextHour, nextMinute);
      onChange(formatValue(date));
    }
  }

  function shiftMonth(delta) {
    let m = viewMonth + delta;
    let y = viewYear;
    if (m < 0) {
      m = 11;
      y -= 1;
    } else if (m > 11) {
      m = 0;
      y += 1;
    }
    setViewMonth(m);
    setViewYear(y);
  }

  function setNow() {
    const now = new Date();
    setViewYear(now.getFullYear());
    setViewMonth(now.getMonth());
    setHour(now.getHours());
    setMinute(now.getMinutes());
    onChange(formatValue(now));
  }

  const firstWeekday = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7; // Пн = 0
  const totalDays = daysInMonth(viewYear, viewMonth);
  const cells = [...Array(firstWeekday).fill(null), ...Array.from({ length: totalDays }, (_, i) => i + 1)];

  const isSelectedDay = (day) =>
    selected && selected.getFullYear() === viewYear && selected.getMonth() === viewMonth && selected.getDate() === day;

  return (
    <div className="datetime-picker" ref={wrapRef}>
      <button type="button" className="datetime-picker-toggle" onClick={() => setOpen((v) => !v)}>
        {selected ? formatDisplay(selected) : placeholder}
      </button>
      {open && (
        <div className="datetime-picker-flyout">
          <div className="datetime-picker-header">
            <button type="button" className="ghost" onClick={() => shiftMonth(-1)}>
              ‹
            </button>
            <span>
              {MONTH_NAMES[viewMonth]} {viewYear}
            </span>
            <button type="button" className="ghost" onClick={() => shiftMonth(1)}>
              ›
            </button>
          </div>
          <div className="datetime-picker-weekdays">
            {WEEKDAY_LABELS.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
          <div className="datetime-picker-grid">
            {cells.map((day, idx) =>
              day === null ? (
                <span key={`empty-${idx}`} />
              ) : (
                <button
                  type="button"
                  key={day}
                  className={`datetime-picker-day${isSelectedDay(day) ? " datetime-picker-day-selected" : ""}`}
                  onClick={() => pickDay(day)}
                >
                  {day}
                </button>
              )
            )}
          </div>
          <div className="datetime-picker-time">
            <select value={hour} onChange={(e) => applyTime(Number(e.target.value), minute)}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {pad(h)}
                </option>
              ))}
            </select>
            <span>:</span>
            <select value={minute} onChange={(e) => applyTime(hour, Number(e.target.value))}>
              {Array.from({ length: 60 / 5 }, (_, i) => i * 5).map((m) => (
                <option key={m} value={m}>
                  {pad(m)}
                </option>
              ))}
            </select>
            <button type="button" className="ghost" onClick={setNow}>
              Сейчас
            </button>
          </div>
          <div className="datetime-picker-actions">
            <button type="button" className="primary" onClick={() => setOpen(false)}>
              Готово
            </button>
            {selected && (
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
              >
                Очистить
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
