import { useEffect, useState } from "react";
import { InlineSpinner } from "./InlineSpinner";
import { TrendChart } from "./TrendChart";

const PRESETS = [
  { key: "week", label: "Неделя" },
  { key: "month", label: "Месяц" },
  { key: "custom", label: "Свои даты" },
];

function rangeFor(preset, customFrom, customTo) {
  const now = new Date();
  if (preset === "week" || preset === "month") {
    const since = new Date(now);
    since.setDate(since.getDate() - (preset === "week" ? 6 : 29));
    since.setHours(0, 0, 0, 0);
    return { since: since.toISOString(), until: now.toISOString() };
  }
  if (!customFrom || !customTo) return null;
  const since = new Date(`${customFrom}T00:00:00`);
  const until = new Date(`${customTo}T23:59:59`);
  if (until <= since) return null;
  return { since: since.toISOString(), until: until.toISOString() };
}

/** Переключатель периода (неделя/месяц/свои даты) + TrendChart — общий для
 * "Состав Ивентрума" и "Сводка активности" Администрации (см. решение
 * пользователя: график активности в обоих местах). Свой period-state, не
 * завязан на соседний недельный/месячный переключатель таблицы/баров —
 * у тех период двигает уже посчитанные на бэкенде поля конкретного бойца
 * (mini_count_week и т.п.), а тут нужен диапазон дат для агрегата по всем
 * сразу, включая произвольные даты, которых в тех полях просто нет. */
export function ActivityTrendPanel({ title, fetchTrend }) {
  const [preset, setPreset] = useState("week");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [trend, setTrend] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const range = rangeFor(preset, customFrom, customTo);
    if (!range) {
      setTrend(null);
      return;
    }
    setError(null);
    fetchTrend(range)
      .then(setTrend)
      .catch((e) => setError(e.message));
  }, [preset, customFrom, customTo, fetchTrend]);

  return (
    <div className="activity-trend-panel">
      <div className="reports-toolbar">
        <h4 style={{ margin: 0 }}>{title}</h4>
        <div className="report-form-actions">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={preset === p.key ? "primary" : "ghost"}
              onClick={() => setPreset(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      {preset === "custom" && (
        <div className="report-form-actions activity-trend-custom-dates">
          <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
          <span className="hint-text">—</span>
          <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
      {!error && (trend ? <TrendChart dates={trend.dates} series={trend.series} /> : <InlineSpinner />)}
    </div>
  );
}
