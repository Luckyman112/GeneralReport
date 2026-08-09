import { useThemeValue } from "../hooks/useTheme";

// Категориальная палитра (валидированная, фиксированный порядок — см. skill dataviz):
// не переставлять и не генерировать новые оттенки, только эти 8 в этом порядке.
const PALETTE_LIGHT = [
  "#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948",
];
const PALETTE_DARK = [
  "#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767",
];
const MAX_SLICES = 7; // 8-й слот уходит в "Остальные"

function buildSlices(data) {
  const sorted = [...data].sort((a, b) => b.count - a.count).filter((d) => d.count > 0);
  if (sorted.length <= MAX_SLICES + 1) return sorted;
  const head = sorted.slice(0, MAX_SLICES);
  const restCount = sorted.slice(MAX_SLICES).reduce((sum, d) => sum + d.count, 0);
  return [...head, { id: null, label: "Остальные", count: restCount }];
}

function arcPath(cx, cy, rOuter, rInner, startAngle, endAngle) {
  const toXY = (angle, r) => [cx + r * Math.sin(angle), cy - r * Math.cos(angle)];
  const large = endAngle - startAngle > Math.PI ? 1 : 0;
  const [x1, y1] = toXY(startAngle, rOuter);
  const [x2, y2] = toXY(endAngle, rOuter);
  const [x3, y3] = toXY(endAngle, rInner);
  const [x4, y4] = toXY(startAngle, rInner);
  return [
    `M ${x1} ${y1}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${x4} ${y4}`,
    "Z",
  ].join(" ");
}

/** Простая доступная кольцевая диаграмма без внешних зависимостей: клик по
 * сегменту/легенде — drill-down, наведение — тултип (нативный title), легенда с
 * подписями (identity никогда только через цвет). */
export function DonutChart({ data, onSegmentClick, emptyLabel = "Нет данных" }) {
  const theme = useThemeValue();
  const slices = buildSlices(data);
  const total = slices.reduce((sum, d) => sum + d.count, 0);

  if (total === 0) {
    return <p className="empty-state">{emptyLabel}</p>;
  }

  const palette = theme === "dark" ? PALETTE_DARK : PALETTE_LIGHT;

  let angle = -Math.PI; // начинаем сверху... но проще с 0 (12 часов = -PI/2*2), используем 0 = верх через смещение
  angle = 0;
  const cx = 90;
  const cy = 90;
  const rOuter = 80;
  const rInner = 46;

  const segments = slices.map((slice, i) => {
    const fraction = slice.count / total;
    const startAngle = angle;
    let endAngle = angle + fraction * 2 * Math.PI;
    angle = endAngle;
    // full-circle arc with matching endpoints renders as empty, shorten it slightly
    if (endAngle - startAngle >= 2 * Math.PI - 1e-6) {
      endAngle -= 1e-3;
    }
    // Если у данных есть свой цвет (например, цвет формирования) — используем его,
    // иначе берём следующий цвет из фиксированной категориальной палитры
    return { ...slice, startAngle, endAngle, color: slice.color || palette[i % palette.length] };
  });

  return (
    <div className="donut-chart">
      <svg viewBox="0 0 180 180" width="180" height="180" role="img" aria-label="Диаграмма">
        {segments.map((seg, i) => (
          <path
            key={seg.id ?? `other-${i}`}
            d={arcPath(cx, cy, rOuter, rInner, seg.startAngle, seg.endAngle)}
            fill={seg.color}
            stroke="var(--surface)"
            strokeWidth="2"
            className={seg.id != null && onSegmentClick ? "donut-segment donut-segment-clickable" : "donut-segment"}
            onClick={seg.id != null && onSegmentClick ? () => onSegmentClick(seg) : undefined}
          >
            <title>
              {seg.label}: {seg.count}
            </title>
          </path>
        ))}
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" className="donut-total">
          {total}
        </text>
      </svg>
      <ul className="donut-legend">
        {segments.map((seg, i) => (
          <li key={seg.id ?? `other-${i}`}>
            <button
              type="button"
              className={seg.id != null && onSegmentClick ? "donut-legend-item" : "donut-legend-item donut-legend-static"}
              onClick={seg.id != null && onSegmentClick ? () => onSegmentClick(seg) : undefined}
              disabled={seg.id == null || !onSegmentClick}
            >
              <span className="donut-swatch" style={{ background: seg.color }} />
              {seg.label} — {seg.count}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
