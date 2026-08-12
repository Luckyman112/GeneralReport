import { PERIOD_PRESETS } from "../hooks/usePeriodFilter";

/** UI для usePeriodFilter — неделя/месяц/всё время/свои даты. Чисто
 * клиентский фильтр списка внутри профиля, без сети. */
export function PeriodFilterBar({ preset, setPreset, customFrom, setCustomFrom, customTo, setCustomTo }) {
  return (
    <div className="report-form-actions no-print" style={{ marginBottom: "0.5rem" }}>
      {PERIOD_PRESETS.map((p) => (
        <button
          key={p.key}
          type="button"
          className={preset === p.key ? "primary" : "ghost"}
          onClick={() => setPreset(p.key)}
        >
          {p.label}
        </button>
      ))}
      {preset === "custom" && (
        <>
          <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
          <span className="hint-text">—</span>
          <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
        </>
      )}
    </div>
  );
}
