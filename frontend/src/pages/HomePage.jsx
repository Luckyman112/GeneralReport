import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { DonutChart } from "../components/DonutChart";
import { InlineSpinner } from "../components/InlineSpinner";
import { PromotionReviewModal } from "../components/PromotionReviewModal";
import { StatusBadge } from "../components/StatusBadge";
import { TransferRequestForm } from "../components/TransferRequestForm";
import { TrendChart } from "../components/TrendChart";
import { useLiveEvents } from "../hooks/useLiveEvents";
import { formatMskDate } from "../utils/formatDate";

const PERIODS = [
  { value: "all", label: "Всё время" },
  { value: "month", label: "Месяц" },
  { value: "week", label: "Неделя" },
  { value: "day", label: "День" },
];

function ProgressBar({ current, required, label }) {
  const pct = required > 0 ? Math.min(100, Math.round((current / required) * 100)) : 100;
  const done = required > 0 ? current >= required : true;
  return (
    <div className="promo-progress">
      <div className="promo-progress-label">
        <span>{label}</span>
        <span className="mono-num">
          {current} / {required}
        </span>
      </div>
      <div className="promo-progress-track">
        <div
          className={done ? "promo-progress-fill promo-progress-fill-done" : "promo-progress-fill"}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function MyReprimands() {
  const { token, user } = useAuth();
  const [reprimands, setReprimands] = useState([]);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      setReprimands(await api.listAllReprimands(token));
    } catch (e) {
      setError(e.message);
    }
  }, [token]);

  useLiveEvents("reprimands", load);

  useEffect(() => {
    load();
  }, [load]);

  const active = reprimands.filter((r) => r.target.discord_id === user?.discord_id && !r.revoked_at);
  if (active.length === 0) return null;

  async function handleSelfRevoke(id) {
    setError(null);
    try {
      await api.selfRevokeReprimand(token, id);
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="regiment-panel fade-in-up">
      <h3>Мои выговоры</h3>
      {error && <p className="error-text">{error}</p>}
      <ul className="member-report-list">
        {active.map((r) => {
          const canSelfRevoke = r.points_required > 0 && r.points_earned >= r.points_required;
          return (
            <li key={r.id}>
              <span className="error-text">{r.severity === "verbal" ? "устный" : "строгий"}</span>
              <p className="member-report-content">{r.reason}</p>
              {r.points_required > 0 && (
                <ProgressBar current={r.points_earned} required={r.points_required} label="Баллов для снятия" />
              )}
              {canSelfRevoke && (
                <button className="primary" onClick={() => handleSelfRevoke(r.id)}>
                  Снять
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const LEAVE_STATUS_LABELS = { pending: "ожидает решения", approved: "одобрена", rejected: "отклонена" };

function CareerHistory() {
  const { token } = useAuth();
  const [history, setHistory] = useState([]);
  const [reviewRequestId, setReviewRequestId] = useState(null);

  useEffect(() => {
    api.getMyPromotionHistory(token).then(setHistory).catch(() => setHistory([]));
  }, [token]);

  if (history.length === 0) return null;

  return (
    <div className="regiment-panel fade-in-up">
      <h3>История повышений</h3>
      <ul className="member-report-list">
        {history.map((r) => (
          <li key={r.id} className="clickable-row" onClick={() => setReviewRequestId(r.id)}>
            <span className={r.status === "approved" ? "hint-text" : "error-text"}>
              {r.status === "approved" ? "одобрено" : "отклонено"}
            </span>
            <span className="member-report-date">{formatMskDate(r.created_at)} МСК</span>
            <p className="member-report-content">
              {r.from_rank?.code || "—"} → {r.to_rank.code} — {r.to_rank.name}
            </p>
          </li>
        ))}
      </ul>

      {reviewRequestId && (
        <PromotionReviewModal requestId={reviewRequestId} onClose={() => setReviewRequestId(null)} />
      )}
    </div>
  );
}

function MyLeaveRequests() {
  const { token, user } = useAuth();
  const [requests, setRequests] = useState([]);

  useEffect(() => {
    api.listLeaveRequests(token).then(setRequests).catch(() => setRequests([]));
  }, [token]);

  const own = requests.filter((r) => r.user.discord_id === user?.discord_id);
  if (own.length === 0) return null;

  return (
    <div className="regiment-panel fade-in-up">
      <h3>Мои отпуска</h3>
      <ul className="member-report-list">
        {own.map((r) => (
          <li key={r.id}>
            <span className="hint-text">{LEAVE_STATUS_LABELS[r.status]}</span>
            <span className="member-report-date">
              {r.start_date} — {r.end_date}
            </span>
            <p className="member-report-content">{r.reason}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

// SSE (см. useLiveEvents) обновляет мгновенно — поллинг оставлен редким запасным
// вариантом на случай обрыва соединения
const PROMOTION_STATUS_POLL_INTERVAL_MS = 60000;

function PromotionStatus() {
  const { token } = useAuth();
  const [status, setStatus] = useState(null);
  const [reviewRequestId, setReviewRequestId] = useState(null);

  const load = useCallback(() => {
    api.getMyPromotionStatus(token).then(setStatus).catch(() => setStatus(null));
  }, [token]);

  useLiveEvents("promotions", load);

  useEffect(() => {
    load();
    const interval = setInterval(load, PROMOTION_STATUS_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load]);

  if (!status) return null;
  if (!status.current_rank) {
    return (
      <div className="regiment-panel fade-in-up">
        <h3>Моё повышение</h3>
        <p className="hint-text">Звание пока не назначено командиром вашего формирования.</p>
      </div>
    );
  }

  return (
    <div className="regiment-panel fade-in-up">
      <h3>Моё повышение</h3>
      <p>
        Текущее звание: <strong>{status.current_rank.code} — {status.current_rank.name}</strong>
      </p>
      {status.next_rank ? (
        <>
          <p>
            Следующее: <strong>{status.next_rank.code} — {status.next_rank.name}</strong>
          </p>

          <ProgressBar current={status.points_current} required={status.points_required} label="Баллы" />
          {status.days_required != null && (
            <ProgressBar current={status.days_in_rank ?? 0} required={status.days_required} label="Дней в звании" />
          )}

          {status.category_requirements?.length > 0 && (
            <ul className="requirement-checklist">
              {status.category_requirements.map((req) => (
                <li
                  key={req.requirement_id}
                  className={req.satisfied ? "requirement-item requirement-item-done" : "requirement-item"}
                >
                  <span className="requirement-check">{req.satisfied && "✓"}</span>
                  <span className="requirement-label">
                    {req.category_name} ({req.count_current} / {req.count_required})
                    {req.is_mandatory && <span className="tag-mandatory">обязательное</span>}
                    {req.overridden && <span className="hint-text"> · переопределено вручную</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {status.has_active_reprimand && (
            <p className="error-text">
              У вас есть непогашенный (строгий) выговор — повышение недоступно, пока он не будет снят.
            </p>
          )}
          {status.pending_request_id != null && (
            <p className="clickable-row" onClick={() => setReviewRequestId(status.pending_request_id)}>
              <StatusBadge status="submitted" /> Повышение уже доступно и ожидает одобрения командующего состава →
            </p>
          )}
        </>
      ) : (
        <p className="hint-text">Вы на высшем звании.</p>
      )}

      {reviewRequestId && (
        <PromotionReviewModal requestId={reviewRequestId} onClose={() => setReviewRequestId(null)} />
      )}
    </div>
  );
}

function RegimentStats({ regimentId, regimentName }) {
  const { token } = useAuth();
  const [period, setPeriod] = useState("all");
  const [stats, setStats] = useState(null);
  const [drillDown, setDrillDown] = useState(null); // { title, reports }
  // Защита от гонки: если период/формирование переключили, пока летел старый
  // запрос, его устаревший ответ не должен затереть уже актуальные данные
  const requestIdRef = useRef(0);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    api
      .getRegimentStats(token, regimentId, period)
      .then((data) => {
        if (requestIdRef.current === requestId) setStats(data);
      })
      .catch(() => {
        if (requestIdRef.current === requestId) setStats(null);
      });
    setDrillDown(null);
  }, [token, regimentId, period]);

  async function handlePersonClick(seg) {
    const reports = await api.getMemberReports(token, regimentId, seg.discord_id);
    setDrillDown({ title: `Рапорты: ${seg.label}`, reports });
  }

  async function handleCategoryClick(seg) {
    const reports = await api.listReports(token, { regimentId, categoryId: seg.id });
    setDrillDown({ title: `Рапорты категории: ${seg.label}`, reports });
  }

  if (!stats) return <InlineSpinner />;

  return (
    <div className="regiment-panel fade-in-up">
      <div className="reports-toolbar">
        <h3 style={{ margin: 0 }}>Статистика — {regimentName}</h3>
        <select value={period} onChange={(e) => setPeriod(e.target.value)}>
          {PERIODS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      <div className="stats-charts-row">
        <div>
          <h4>По бойцам</h4>
          <DonutChart data={stats.by_person} onSegmentClick={handlePersonClick} />
        </div>
        <div>
          <h4>По категориям</h4>
          <DonutChart data={stats.by_category} onSegmentClick={handleCategoryClick} />
        </div>
      </div>

      {drillDown && (
        <div className="drilldown-panel">
          <div className="reports-toolbar">
            <h4 style={{ margin: 0 }}>{drillDown.title}</h4>
            <button className="ghost" onClick={() => setDrillDown(null)}>
              Закрыть
            </button>
          </div>
          {drillDown.reports.length === 0 ? (
            <p className="hint-text">Рапортов нет.</p>
          ) : (
            <ul className="member-report-list">
              {drillDown.reports.map((r) => (
                <li key={r.id}>
                  <StatusBadge status={r.status} />
                  <span className="member-report-date">{formatMskDate(r.created_at)} МСК</span>
                  <p className="member-report-content">{r.content}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function FormationComparison() {
  const { token } = useAuth();
  const [period, setPeriod] = useState("all");
  const [stats, setStats] = useState(null);
  const [drillDown, setDrillDown] = useState(null); // { title, reports }
  const requestIdRef = useRef(0);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    api
      .getFormationStats(token, period)
      .then((data) => {
        if (requestIdRef.current === requestId) setStats(data);
      })
      .catch(() => {
        if (requestIdRef.current === requestId) setStats(null);
      });
    setDrillDown(null);
  }, [token, period]);

  async function handleRegimentClick(seg) {
    const reports = await api.listReports(token, { regimentId: seg.id });
    setDrillDown({ title: `Рапорты: ${seg.label}`, reports });
  }

  return (
    <div className="regiment-panel fade-in-up">
      <div className="reports-toolbar">
        <h3 style={{ margin: 0 }}>Активность формирований</h3>
        <select value={period} onChange={(e) => setPeriod(e.target.value)}>
          {PERIODS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      {stats ? <DonutChart data={stats.by_regiment} onSegmentClick={handleRegimentClick} /> : <InlineSpinner />}

      {stats && stats.trend && stats.trend.length > 0 && (
        <div className="trend-chart-wrap">
          <h4>Динамика за последние 30 дней</h4>
          <TrendChart dates={stats.trend_dates} series={stats.trend} />
        </div>
      )}

      {drillDown && (
        <div className="drilldown-panel">
          <div className="reports-toolbar">
            <h4 style={{ margin: 0 }}>{drillDown.title}</h4>
            <button className="ghost" onClick={() => setDrillDown(null)}>
              Закрыть
            </button>
          </div>
          {drillDown.reports.length === 0 ? (
            <p className="hint-text">Рапортов нет.</p>
          ) : (
            <ul className="member-report-list">
              {drillDown.reports.map((r) => (
                <li key={r.id}>
                  <StatusBadge status={r.status} />
                  <span className="member-report-date">{formatMskDate(r.created_at)} МСК</span>
                  <p className="member-report-content">{r.content}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function TransferRequestBlock() {
  const { token, access, refreshMe } = useAuth();
  const [showForm, setShowForm] = useState(false);

  const canRequestTransfer = (access?.soldier_regiment_ids || []).length === 1 && !access?.active_transfer;
  if (!canRequestTransfer && !access?.active_transfer) return null;

  async function handleCreateTransfer({ toRegimentId, reason }) {
    await api.createTransferRequest(token, { toRegimentId, reason });
    setShowForm(false);
    await refreshMe();
  }

  return (
    <div className="regiment-panel fade-in-up">
      <h3>Перевод в другое формирование</h3>
      {access?.active_transfer ? (
        <p className="hint-text">У вас уже есть активная заявка на перевод — дождитесь решения обеих сторон.</p>
      ) : showForm ? (
        <TransferRequestForm
          currentRegimentId={(access?.soldier_regiment_ids || [])[0]}
          onSubmit={handleCreateTransfer}
          onCancel={() => setShowForm(false)}
        />
      ) : (
        <button onClick={() => setShowForm(true)}>Подать заявку на перевод</button>
      )}
    </div>
  );
}

export function HomePage() {
  const { access, regiments } = useAuth();

  const ownRegimentIds = useMemo(
    () => [...new Set([...(access?.commander_regiment_ids || []), ...(access?.soldier_regiment_ids || [])])],
    [access]
  );
  const ownRegiments = regiments.filter((r) => ownRegimentIds.includes(r.id));

  return (
    <div className="home-page">
      <h2>Главное</h2>

      <PromotionStatus />
      <CareerHistory />
      <MyReprimands />
      <MyLeaveRequests />
      <TransferRequestBlock />

      {ownRegiments.length === 1 && (
        <RegimentStats regimentId={ownRegiments[0].id} regimentName={ownRegiments[0].name} />
      )}

      {(access?.is_admin || access?.is_high_command) && <FormationComparison />}
    </div>
  );
}
