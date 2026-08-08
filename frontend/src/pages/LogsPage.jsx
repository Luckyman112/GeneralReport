import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { EmptyState } from "../components/EmptyState";
import { PageLoading } from "../components/PageLoading";
import { formatMskDate } from "../utils/formatDate";
import { formatFullName } from "../utils/formatName";

// Человекочитаемые подписи для action — коды см. app/crud/audit_log.py::log()
// вызовы по всему backend. Группы — просто для дропдауна фильтра, на сам журнал
// не влияют.
const ACTION_GROUPS = [
  {
    label: "Рапорты",
    actions: {
      report_status_change: "Смена статуса рапорта",
      report_delete: "Удаление рапорта",
      report_points_set: "Выставление баллов",
      detention_report_delete: "Аннулирование задержания",
    },
  },
  {
    label: "Объявления",
    actions: {
      broadcast_create: "Отправка объявления",
      broadcast_delete: "Удаление объявления",
    },
  },
  {
    label: "Формирования и категории",
    actions: {
      regiment_create: "Создание формирования",
      regiment_update: "Изменение формирования",
      category_create: "Создание категории",
      category_update: "Изменение категории",
      category_delete: "Удаление категории",
      commander_assign: "Назначение командира",
      commander_remove: "Снятие командира",
    },
  },
  {
    label: "Заявки",
    actions: {
      transfer_approve_source: "Одобрение перевода (источник)",
      transfer_approve_target: "Одобрение перевода (получатель)",
      transfer_reject: "Отклонение перевода",
      leave_approve: "Одобрение отпуска",
      leave_reject: "Отклонение отпуска",
      registration_approve: "Одобрение регистрации",
      registration_reject: "Отклонение регистрации",
      mandatory_requirement_create: "Создание обязательного требования",
      mandatory_requirement_update: "Изменение обязательного требования",
      mandatory_requirement_delete: "Удаление обязательного требования",
      requirement_override: "Персональный оверрайд требования",
    },
  },
  {
    label: "Бойцы",
    actions: {
      member_profile_edit: "Правка профиля бойца",
      tenure_override: "Изменение выслуги",
      points_adjustment: "Ручное начисление баллов",
      reprimand_issue: "Выговор",
      reprimand_revoke: "Снятие выговора",
      reprimand_delete: "Удаление выговора",
      violation_delete: "Удаление нарушения",
      wanted_create: "Объявление в розыск",
      wanted_resolve: "Снятие с розыска",
      wanted_delete: "Удаление записи розыска",
      specialization_grant: "Выдача специализации",
      specialization_revoke: "Снятие специализации",
      specialization_ban_create: "Запрет на обучение",
    },
  },
  {
    label: "Ивентрум",
    actions: {
      event_create: "Подача заявки на ивент",
      event_update: "Дозаполнение заявки на ивент",
      event_approve: "Одобрение ивента",
      event_reject: "Отклонение ивента",
    },
  },
  {
    label: "Настройки",
    actions: {
      settings_roles_update: "Изменение ролей доступа",
      settings_module_access_update: "Настройка модуля доступа",
      settings_tier_tenure_update: "Выслуга состава",
      settings_tier_limits_update: "Лимиты состава",
      settings_rank_tenure_update: "Выслуга звания",
      admin_points_update: "Изменение требований по баллам",
      instructor_role_create: "Добавление роли инструктора",
      instructor_role_delete: "Удаление роли инструктора",
      maintenance_toggle: "Режим обслуживания",
    },
  },
];

const ACTION_LABELS = Object.fromEntries(ACTION_GROUPS.flatMap((g) => Object.entries(g.actions)));

// Действия, после которых что-то безвозвратно исчезает — подсвечиваем красным,
// чтобы такие записи бросались в глаза при беглом просмотре
const DESTRUCTIVE_ACTIONS = new Set([
  "report_delete",
  "detention_report_delete",
  "broadcast_delete",
  "category_delete",
  "commander_remove",
  "reprimand_delete",
  "violation_delete",
  "wanted_delete",
  "specialization_revoke",
  "instructor_role_delete",
  "mandatory_requirement_delete",
]);

function actionLabel(action) {
  return ACTION_LABELS[action] || action;
}

const DISCIPLINE_LABELS = {
  medic: "Медицина",
  pilot: "Пилотирование",
  engineer: "Инженерия",
};

export function LogsPage() {
  const { token, access } = useAuth();
  const isAdmin = Boolean(access?.is_admin);
  const ownDisciplines = access?.deputy_disciplines || [];
  const [entries, setEntries] = useState([]);
  const [actionFilter, setActionFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [adminOnly, setAdminOnly] = useState(false);
  const [discipline, setDiscipline] = useState(ownDisciplines[0] || "");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isAdmin && !discipline && ownDisciplines[0]) setDiscipline(ownDisciplines[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownDisciplines]);

  function load() {
    if (!isAdmin && !discipline) return;
    setLoading(true);
    setError(null);
    api
      .listAuditLog(
        token,
        isAdmin
          ? { action: actionFilter, dateFrom, dateTo, adminOnly, limit: 500 }
          : { dateFrom, dateTo, discipline, limit: 500 }
      )
      .then(setEntries)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const groupedByDay = useMemo(() => {
    const groups = new Map();
    for (const entry of entries) {
      const day = formatMskDate(entry.created_at);
      if (!groups.has(day)) groups.set(day, []);
      groups.get(day).push(entry);
    }
    return [...groups.entries()];
  }, [entries]);

  if (loading && entries.length === 0) return <PageLoading />;

  return (
    <div className="page-container logs-page">
      <h2>Журнал действий</h2>
      <p className="hint-text">
        {isAdmin
          ? "Все значимые административные и командирские решения — кто, что и когда сделал. Рутинные действия рядового состава (подача своих рапортов, чтение) сюда не попадают."
          : "Только действия по специализациям вашей дисциплины (выдача, снятие, запрет на обучение)."}
      </p>

      <div className="reports-toolbar">
        {isAdmin ? (
          <>
            <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)}>
              <option value="">Все действия</option>
              {ACTION_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {Object.entries(group.actions).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <label className="checkbox-label">
              <input type="checkbox" checked={adminOnly} onChange={(e) => setAdminOnly(e.target.checked)} />
              Только администраторы
            </label>
          </>
        ) : (
          ownDisciplines.length > 1 && (
            <select value={discipline} onChange={(e) => setDiscipline(e.target.value)}>
              {ownDisciplines.map((d) => (
                <option key={d} value={d}>
                  {DISCIPLINE_LABELS[d] || d}
                </option>
              ))}
            </select>
          )
        )}
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} title="С даты" />
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} title="По дату" />
        <button type="button" className="primary" onClick={load} disabled={loading}>
          {loading ? "Загрузка…" : "Применить"}
        </button>
      </div>

      {error && <p className="error-text">{error}</p>}

      {entries.length === 0 ? (
        <EmptyState text="Записей не найдено." />
      ) : (
        <div className="logs-days">
          {groupedByDay.map(([day, dayEntries]) => (
            <div key={day} className="logs-day-group">
              <h4 className="logs-day-heading">{day} МСК</h4>
              <ul className="logs-list">
                {dayEntries.map((entry) => (
                  <li
                    key={entry.id}
                    className={`logs-row${DESTRUCTIVE_ACTIONS.has(entry.action) ? " logs-row-destructive" : ""}`}
                  >
                    <span className="logs-row-time">
                      {new Date(entry.created_at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <span className="logs-row-action">{actionLabel(entry.action)}</span>
                    <span className="logs-row-actor">
                      {formatFullName(entry.actor)}
                      {entry.actor_is_admin && <span className="detention-badge">админ</span>}
                    </span>
                    {entry.target && <span className="logs-row-target">→ {formatFullName(entry.target)}</span>}
                    <p className="logs-row-details">{entry.details}</p>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
