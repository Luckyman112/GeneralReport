/** Простая горизонтальная столбчатая диаграмма без внешних зависимостей — один
 * показатель на человека (сравнение величин), поэтому один акцентный цвет без
 * категориальной палитры (см. skill dataviz: единственная серия — легенда не
 * нужна, идентичность и так видна по подписи слева). Наведение — нативный
 * title-тултип с точным значением. */
export function HorizontalBarChart({ data, emptyLabel = "Нет данных за этот период" }) {
  const sorted = [...data].sort((a, b) => b.value - a.value);
  const max = Math.max(1, ...sorted.map((d) => d.value));

  if (sorted.every((d) => d.value === 0)) {
    return <p className="empty-state">{emptyLabel}</p>;
  }

  return (
    <div className="hbar-chart">
      {sorted.map((d) => (
        <div key={d.id} className="hbar-chart-row" title={`${d.label}: ${d.value}`}>
          <span className="hbar-chart-label">{d.label}</span>
          <span className="hbar-chart-track">
            <span className="hbar-chart-fill" style={{ width: `${(d.value / max) * 100}%` }} />
          </span>
          <span className="hbar-chart-value">{d.value}</span>
        </div>
      ))}
    </div>
  );
}
