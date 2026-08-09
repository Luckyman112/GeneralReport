import { useState } from "react";
import { useThemeValue } from "../hooks/useTheme";

const PALETTE_LIGHT = [
  "#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948",
];
const PALETTE_DARK = [
  "#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767",
];

const WIDTH = 640;
const HEIGHT = 200;
const PAD_LEFT = 28;
const PAD_BOTTOM = 20;
const PAD_TOP = 10;

function formatShortDate(iso) {
  const [, m, d] = iso.split("-");
  return `${d}.${m}`;
}

/** Лёгкий линейный график без зависимостей: один цвет = одно формирование
 * (тот же Regiment.color, что и в остальной статистике), вертикальная
 * направляющая при наведении показывает значения всех серий в этот день. */
export function TrendChart({ dates, series }) {
  const theme = useThemeValue();
  const [hoverIndex, setHoverIndex] = useState(null);

  const visibleSeries = series.filter((s) => s.points.some((p) => p > 0));
  if (dates.length === 0 || visibleSeries.length === 0) {
    return <p className="empty-state">Недостаточно данных за период.</p>;
  }

  const palette = theme === "dark" ? PALETTE_DARK : PALETTE_LIGHT;

  const max = Math.max(1, ...visibleSeries.flatMap((s) => s.points));
  const plotWidth = WIDTH - PAD_LEFT;
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const xStep = dates.length > 1 ? plotWidth / (dates.length - 1) : 0;
  const xAt = (i) => PAD_LEFT + i * xStep;
  const yAt = (v) => PAD_TOP + plotHeight - (v / max) * plotHeight;

  const coloredSeries = visibleSeries.map((s, i) => ({ ...s, color: s.color || palette[i % palette.length] }));

  function handleMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * WIDTH;
    const idx = Math.round((x - PAD_LEFT) / (xStep || 1));
    setHoverIndex(Math.min(dates.length - 1, Math.max(0, idx)));
  }

  const gridLines = [0, 0.5, 1];

  return (
    <div className="trend-chart">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="trend-chart-svg"
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIndex(null)}
        role="img"
        aria-label="График активности формирований по дням"
      >
        {gridLines.map((frac) => (
          <line
            key={frac}
            x1={PAD_LEFT}
            x2={WIDTH}
            y1={PAD_TOP + plotHeight * (1 - frac)}
            y2={PAD_TOP + plotHeight * (1 - frac)}
            className="trend-chart-grid"
          />
        ))}
        <text x={2} y={PAD_TOP + 4} className="trend-chart-axis-label">
          {max}
        </text>
        <text x={2} y={PAD_TOP + plotHeight + 4} className="trend-chart-axis-label">
          0
        </text>

        {coloredSeries.map((s) => (
          <polyline
            key={s.id}
            fill="none"
            stroke={s.color}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            points={s.points.map((v, i) => `${xAt(i)},${yAt(v)}`).join(" ")}
          />
        ))}

        {hoverIndex !== null && (
          <line
            x1={xAt(hoverIndex)}
            x2={xAt(hoverIndex)}
            y1={PAD_TOP}
            y2={PAD_TOP + plotHeight}
            className="trend-chart-cursor"
          />
        )}
        {hoverIndex !== null &&
          coloredSeries.map((s) => (
            <circle key={s.id} cx={xAt(hoverIndex)} cy={yAt(s.points[hoverIndex])} r="3" fill={s.color} />
          ))}

        <text x={xAt(0)} y={HEIGHT - 4} className="trend-chart-axis-label">
          {formatShortDate(dates[0])}
        </text>
        <text x={xAt(dates.length - 1)} y={HEIGHT - 4} textAnchor="end" className="trend-chart-axis-label">
          {formatShortDate(dates[dates.length - 1])}
        </text>
      </svg>

      {hoverIndex !== null && (
        <div className="trend-chart-tooltip">
          <strong>{dates[hoverIndex]}</strong>
          {coloredSeries.map((s) => (
            <p key={s.id}>
              <span className="trend-chart-tooltip-swatch" style={{ background: s.color }} />
              {s.label}: {s.points[hoverIndex]}
            </p>
          ))}
        </div>
      )}

      <ul className="donut-legend">
        {coloredSeries.map((s) => (
          <li key={s.id}>
            <span className="donut-legend-item donut-legend-static">
              <span className="donut-swatch" style={{ background: s.color }} />
              {s.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
