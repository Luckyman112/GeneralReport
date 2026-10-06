import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { formatMskDate } from "../../utils/formatDate";
import { EmptyState } from "../EmptyState";
import { EventMemberDetailModal } from "../EventMemberDetailModal";
import { HorizontalBarChart } from "../HorizontalBarChart";
import { InlineSpinner } from "../InlineSpinner";
import { TrendChart } from "../TrendChart";

const ROLE_LABELS = {
  куратор: "Куратор",
  ассистент: "Ассистент",
  "старший ивентолог": "Старший Ивентолог",
  ивентолог: "Ивентолог",
  "младший ивентолог": "Младший Ивентолог",
};

const PERIODS = [
  { key: "week", label: "Неделя" },
  { key: "month", label: "Месяц" },
  { key: "all", label: "Всё время" },
  { key: "custom", label: "Свои даты" },
];

/** Диапазон периода. «Всё время» — без границ (бэкенд берёт с первого отчёта). */
function rangeOf(period, from, to) {
  const now = new Date();
  if (period === "week" || period === "month") {
    const since = new Date(now);
    since.setDate(since.getDate() - (period === "week" ? 6 : 29));
    since.setHours(0, 0, 0, 0);
    return { since: since.toISOString(), until: now.toISOString() };
  }
  if (period === "all") return {};
  if (!from || !to) return null;
  const since = new Date(`${from}T00:00:00`);
  const until = new Date(`${to}T23:59:59`);
  return until > since ? { since: since.toISOString(), until: until.toISOString() } : null;
}

/** Состав Ивентрума. Один период двигает всё сразу: таблицу (и заявки, и
 * отчёты считаются только за него), столбики и график по дням. График можно
 * переключить с «по типам» на «по людям», чтобы видеть, кто даёт активность. */
export function RosterPanel() {
  const { token } = useAuth();
  const [period, setPeriod] = useState("week");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [group, setGroup] = useState("type");
  const [roster, setRoster] = useState(null);
  const [trend, setTrend] = useState(null);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const rosterReq = useRef(0);
  const trendReq = useRef(0);

  const range = useMemo(() => rangeOf(period, from, to), [period, from, to]);

  useEffect(() => {
    if (!range) return;
    const id = ++rosterReq.current;
    setError(null);
    api
      .getEventRoster(token, range)
      .then((data) => rosterReq.current === id && setRoster(data))
      .catch((e) => rosterReq.current === id && setError(e.message));
  }, [token, range]);

  useEffect(() => {
    if (!range) return;
    const id = ++trendReq.current;
    setTrend(null);
    api
      .getEventRosterTrend(token, { ...range, group })
      .then((data) => trendReq.current === id && setTrend(data))
      .catch(() => trendReq.current === id && setTrend({ dates: [], series: [] }));
  }, [token, range, group]);

  const totals = useMemo(() => {
    const t = { mini: 0, combat: 0, rp: 0 };
    for (const r of roster || []) {
      t.mini += r.mini_count;
      t.combat += r.combat_count;
      t.rp += r.rp_count;
    }
    return t;
  }, [roster]);

  const bars = (field) => (roster || []).map((r) => ({ id: r.discord_id, label: r.username, value: r[field] || 0 }));
  const allBars = (roster || []).map((r) => ({
    id: r.discord_id,
    label: r.username,
    value: r.mini_count + r.combat_count + r.rp_count,
  }));

  return (
    <div className="regiment-panel">
      <div className="reports-toolbar">
        <h3 style={{ margin: 0 }}>Состав Ивентрума</h3>
        <div className="report-form-actions">
          {PERIODS.map((p) => (
            <button key={p.key} type="button" className={p.key === period ? "primary" : "ghost"} onClick={() => setPeriod(p.key)}>
              {p.label}
            </button>
          ))}
        </div>
      </div>
      {period === "custom" && (
        <div className="report-form-actions activity-trend-custom-dates">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="С даты" />
          <span className="hint-text">—</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="По дату" />
          {!range && <span className="hint-text">выберите обе даты</span>}
        </div>
      )}
      {error && <p className="error-text">{error}</p>}

      {roster === null ? (
        <InlineSpinner />
      ) : roster.length === 0 ? (
        <EmptyState text="Роли Ивентрума ещё не настроены или никто их не занимает." />
      ) : (
        <>
          <p className="hint-text">
            За период: мини-ивентов {totals.mini} · боевых вылетов {totals.combat} · РП ивентов {totals.rp}. Заявки и отчёты в
            таблице считаются тоже только за выбранный период.
          </p>
          <div className="roster-table-wrap-full">
            <table className="roster-table roster-table-wide roster-table-full">
              <thead>
                <tr>
                  <th>Участник</th>
                  <th>Роль</th>
                  <th>Заявок подано</th>
                  <th>Одобрено</th>
                  <th>Отклонено</th>
                  <th>Мини-ивент</th>
                  <th>Боевой вылет</th>
                  <th>РП ивент</th>
                  <th>Последний отчёт</th>
                </tr>
              </thead>
              <tbody>
                {roster.map((r) => (
                  <tr key={r.discord_id} onClick={() => setSelected(r.discord_id)}>
                    <td>{r.username}</td>
                    <td>{ROLE_LABELS[r.role] || r.role}</td>
                    <td className="mono-num">{r.submitted_count}</td>
                    <td className="mono-num">{r.approved_count}</td>
                    <td className="mono-num">{r.rejected_count}</td>
                    <td className="mono-num">{r.mini_count}</td>
                    <td className="mono-num">{r.combat_count}</td>
                    <td className="mono-num">{r.rp_count}</td>
                    <td>{r.activity_last_report_at ? formatMskDate(r.activity_last_report_at) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="roster-bars">
            <div>
              <h4>Всего мероприятий</h4>
              <HorizontalBarChart data={allBars} />
            </div>
            <div>
              <h4>Мини-ивенты</h4>
              <HorizontalBarChart data={bars("mini_count")} />
            </div>
            <div>
              <h4>Боевые вылеты</h4>
              <HorizontalBarChart data={bars("combat_count")} />
            </div>
            <div>
              <h4>РП ивенты</h4>
              <HorizontalBarChart data={bars("rp_count")} />
            </div>
          </div>

          <div className="activity-trend-panel">
            <div className="reports-toolbar">
              <h4 style={{ margin: 0 }}>Активность по дням</h4>
              <div className="report-form-actions">
                <button type="button" className={group === "type" ? "primary" : "ghost"} onClick={() => setGroup("type")}>
                  По типам
                </button>
                <button type="button" className={group === "person" ? "primary" : "ghost"} onClick={() => setGroup("person")}>
                  По людям
                </button>
              </div>
            </div>
            <p className="hint-text">
              {group === "type"
                ? "Линии — мини-ивенты, боевые вылеты и РП ивенты (одобренные отчёты)."
                : "Линия на каждого ивентолога — видно, кто даёт активность. Самые активные отдельно, остальные — общей линией."}
            </p>
            {trend ? <TrendChart dates={trend.dates} series={trend.series} /> : <InlineSpinner />}
          </div>
        </>
      )}

      {selected && <EventMemberDetailModal discordId={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
