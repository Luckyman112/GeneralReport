import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { PageLoading } from "../components/PageLoading";
import { EmptyState } from "../components/EmptyState";
import { MemberSearchPicker } from "../components/MemberSearchPicker";
import { StatusBadge } from "../components/StatusBadge";
import { InfoHint } from "../components/Tooltip";
import { TrainingReportForm } from "../components/TrainingReportForm";
import { formatMskDate } from "../utils/formatDate";
import { formatFullName, formatFullNameAtRank } from "../utils/formatName";

const CATEGORY_LABELS = {
  class: "Общий класс",
  gear: "Общее снаряжение",
  specialization: "Общая специализация",
  additional_specialization: "Доп. специализация",
  elite_specialization: "Элитная специализация",
};

const TIER_LIMIT_FIELDS = [
  ["class_limit", "class"],
  ["gear_limit", "gear"],
  ["specialization_limit", "specialization"],
  ["additional_specialization_limit", "additional_specialization"],
  ["elite_specialization_limit", "elite_specialization"],
];

// Кадетский корпус — состав рекрутов (RCT), которые ещё не завершили обучение
// на сервере и не имеют вообще никакого доступа к обучению специализациям —
// показывать его в таблице ограничений бессмысленно, только сбивает с толку
const EXCLUDED_TIER_NAME = "Кадетский корпус";

function formatLimitCell(value) {
  if (value === 0) return "запрещено";
  if (value == null) return "без ограничений";
  return `не более ${value}`;
}

/** "Инструкторская" — как "Нарушители", но видна всем: на главной показывает
 * каталог специализаций с требованиями по составу (сколько какой категории можно
 * держать одновременно), а инструкторам/тем, кому настроен просмотр (см.
 * can_view_trainings) — ещё и сами рапорты об обучении, сгруппированные по
 * специализации (в отличие от формирования, где рапорты об обучении лежат одним
 * общим списком в категории "Обучение на специализацию"). Подавать такой рапорт
 * может только инструктор (can_grant_specializations) — это отдельное право от
 * простого просмотра. */
export function InstructorRoomPage() {
  const { token, access, regiments } = useAuth();
  const [specializations, setSpecializations] = useState([]);
  const [tiers, setTiers] = useState([]);
  const [categoriesById, setCategoriesById] = useState({});
  const [trainingReports, setTrainingReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showTrainingForm, setShowTrainingForm] = useState(false);
  const [instructorActivity, setInstructorActivity] = useState([]);
  const [error, setError] = useState(null);

  const [banRegimentId, setBanRegimentId] = useState("");
  const [banMembers, setBanMembers] = useState([]);
  const [banTargetDiscordId, setBanTargetDiscordId] = useState("");
  const [banSpecializationId, setBanSpecializationId] = useState("");
  const [banUntilDate, setBanUntilDate] = useState("");
  const [banPermanent, setBanPermanent] = useState(false);
  const [banReason, setBanReason] = useState("");
  const [targetBans, setTargetBans] = useState([]);
  const [activeBans, setActiveBans] = useState([]);

  const isInstructor = Boolean(access?.can_grant_specializations);
  const canViewTrainings = Boolean(access?.can_view_trainings);
  // Запрет на обучение — привилегия DEP/CU дисциплины (или админа на "всё
  // обучение"/недисциплинарные специализации), обычный инструктор её больше
  // не видит, см. app/api/specializations.py::create_specialization_ban
  const canManageBans = Boolean(access?.is_admin || (access?.deputy_disciplines || []).length > 0);
  const banSpecializationOptions = useMemo(() => {
    if (access?.is_admin) return specializations;
    const own = new Set(access?.deputy_disciplines || []);
    return specializations.filter((s) => own.has(s.category));
  }, [specializations, access]);

  const accessibleRegimentIds = useMemo(() => {
    if (!access) return [];
    // instructors see/grant training across every regiment, not only their own
    if (access.is_admin || access.is_high_command || access.can_grant_specializations) {
      return regiments.map((r) => r.id);
    }
    return [...new Set([...(access.commander_regiment_ids || []), ...(access.soldier_regiment_ids || [])])];
  }, [access, regiments]);

  const creatableRegiments = useMemo(
    () => regiments.filter((r) => accessibleRegimentIds.includes(r.id)),
    [regiments, accessibleRegimentIds]
  );

  // "от чьего лица подаётся" — только формирования, где инструктор состоит сам
  // (не весь список, в отличие от истории/поиска состава/запрета на обучение)
  const ownRegimentIds = useMemo(() => {
    if (!access) return [];
    if (access.is_admin || access.is_high_command) return regiments.map((r) => r.id);
    return [...new Set([...(access.commander_regiment_ids || []), ...(access.soldier_regiment_ids || [])])];
  }, [access, regiments]);

  const ownRegiments = useMemo(
    () => regiments.filter((r) => ownRegimentIds.includes(r.id)),
    [regiments, ownRegimentIds]
  );

  const displayTiers = useMemo(
    () => tiers.filter((t) => t.name !== EXCLUDED_TIER_NAME && !t.is_jedi),
    [tiers]
  );

  async function loadCatalog() {
    const [specs, ranks] = await Promise.all([api.listSpecializations(token), api.getRanks(token)]);
    setSpecializations(specs);
    setTiers(ranks);
  }

  async function loadTrainingReports() {
    if (!canViewTrainings) return;
    const categoriesByRegiment = await Promise.all(
      creatableRegiments.map((r) => api.listCategories(token, r.id).then((cats) => ({ regimentId: r.id, cats })))
    );
    const byId = {};
    const trainingCategoryIds = [];
    for (const { cats } of categoriesByRegiment) {
      for (const c of cats) {
        byId[c.id] = c;
        if (c.is_training) trainingCategoryIds.push(c.id);
      }
    }
    setCategoriesById(byId);

    const reportLists = await Promise.all(
      trainingCategoryIds.map((categoryId) => api.listReports(token, { categoryId }))
    );
    setTrainingReports(reportLists.flat());
  }

  useEffect(() => {
    setLoading(true);
    Promise.all([loadCatalog(), loadTrainingReports()])
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, canViewTrainings, creatableRegiments.length]);

  const [activityPeriod, setActivityPeriod] = useState("all");

  useEffect(() => {
    if (!access?.is_admin) return;
    api.getInstructorActivity(token, activityPeriod).then(setInstructorActivity).catch(() => setInstructorActivity([]));
  }, [token, access?.is_admin, activityPeriod]);

  const maxGrantsCount = useMemo(
    () => instructorActivity.reduce((max, a) => Math.max(max, a.grants_count), 0),
    [instructorActivity]
  );

  const specializationsByCategory = useMemo(() => {
    const map = new Map();
    for (const s of specializations) {
      if (!map.has(s.category)) map.set(s.category, []);
      map.get(s.category).push(s);
    }
    return map;
  }, [specializations]);

  const reportsBySpecialization = useMemo(() => {
    const map = new Map();
    for (const r of trainingReports) {
      const specs = r.training_specializations?.length
        ? r.training_specializations
        : [null];
      for (const spec of specs) {
        const label = spec ? `${spec.code} — ${spec.name}` : "Без указания специализации";
        if (!map.has(label)) map.set(label, []);
        map.get(label).push(r);
      }
    }
    return map;
  }, [trainingReports]);

  async function handleCreateTraining(payload) {
    await api.createReport(token, { ...payload, submit: true });
    setShowTrainingForm(false);
    await loadTrainingReports();
  }

  useEffect(() => {
    // Без бланкетного варианта ("— всё обучение —") у DEP/CU выбранное значение
    // должно всегда указывать на реальную специализацию их ветки, иначе select
    // визуально показывает первый option, а состояние остаётся рассинхронизировано
    if (access?.is_admin) return;
    if (banSpecializationId && banSpecializationOptions.some((s) => String(s.id) === String(banSpecializationId))) return;
    setBanSpecializationId(banSpecializationOptions[0] ? String(banSpecializationOptions[0].id) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access?.is_admin, banSpecializationOptions]);

  useEffect(() => {
    if (!banRegimentId) {
      setBanMembers([]);
      return;
    }
    // getMembers requires actual membership in the regiment; instructors banning
    // across regiments they don't belong to need the broader candidates endpoint
    api.getViolationTargetCandidates(token, banRegimentId).then(setBanMembers).catch(() => setBanMembers([]));
    setBanTargetDiscordId("");
  }, [token, banRegimentId]);

  function loadTargetBans() {
    if (!banTargetDiscordId) {
      setTargetBans([]);
      return;
    }
    api.listSpecializationBans(token, banTargetDiscordId).then(setTargetBans).catch(() => setTargetBans([]));
  }

  useEffect(() => {
    loadTargetBans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, banTargetDiscordId]);

  function loadActiveBans() {
    if (!isInstructor) return;
    api.listActiveSpecializationBans(token).then(setActiveBans).catch(() => setActiveBans([]));
  }

  useEffect(() => {
    loadActiveBans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, isInstructor]);

  async function handleCreateBan() {
    if (!banTargetDiscordId || (!banPermanent && !banUntilDate)) return;
    try {
      await api.createSpecializationBan(token, banTargetDiscordId, {
        specializationId: banSpecializationId ? Number(banSpecializationId) : null,
        untilDate: banPermanent ? null : banUntilDate,
        reason: banReason.trim(),
      });
      setBanSpecializationId("");
      setBanUntilDate("");
      setBanPermanent(false);
      setBanReason("");
      loadTargetBans();
      loadActiveBans();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDeleteBan(banId) {
    try {
      await api.deleteSpecializationBan(token, banTargetDiscordId, banId);
      loadTargetBans();
      loadActiveBans();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDeleteActiveBan(ban) {
    try {
      await api.deleteSpecializationBan(token, ban.user.discord_id, ban.id);
      loadActiveBans();
      if (ban.user.discord_id === banTargetDiscordId) loadTargetBans();
    } catch (e) {
      setError(e.message);
    }
  }

  if (loading) return <PageLoading />;

  return (
    <div className="instructor-room-page">
      <h2>Инструкторская</h2>

      {error && <p className="error-text">{error}</p>}

      <div className="regiment-panel">
        <h3>Специализации</h3>
        {[...specializationsByCategory.entries()].map(([category, specs]) => (
          <div key={category} className="member-list-group">
            <p className="member-list-group-title">{CATEGORY_LABELS[category] || category}</p>
            <div className="table-scroll">
              <table className="category-points-table specialization-catalog-table">
                <thead>
                  <tr>
                    <th>Специализация</th>
                    <th>Требование по званию</th>
                  </tr>
                </thead>
                <tbody>
                  {specs.map((s) => (
                    <tr key={s.id}>
                      <td>{s.code} — {s.name}</td>
                      <td>{s.min_rank ? `от ${s.min_rank.code}` : "не требуется"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
        {specializations.length === 0 && <EmptyState text="Каталог специализаций пока пуст." />}
      </div>

      {canViewTrainings && (
        <div className="regiment-panel">
          <div className="reports-toolbar">
            <h3 style={{ margin: 0 }}>Рапорты об обучении</h3>
            {isInstructor && !showTrainingForm && (
              <button className="primary" onClick={() => setShowTrainingForm(true)}>
                Рапорт об обучении
              </button>
            )}
          </div>

          {showTrainingForm && (
            <TrainingReportForm
              regiments={ownRegiments}
              categoriesById={categoriesById}
              onSubmit={handleCreateTraining}
              onCancel={() => setShowTrainingForm(false)}
            />
          )}

          {reportsBySpecialization.size === 0 ? (
            <EmptyState text="Рапортов об обучении пока нет." />
          ) : (
            <div className="training-spec-grid">
              {[...reportsBySpecialization.entries()].map(([label, reports]) => (
                <details key={label} className="training-spec-group">
                  <summary>
                    {label} <span className="category-points-badge">{reports.length}</span>
                  </summary>
                  <ul className="member-report-list">
                    {reports.map((r) => (
                      <li key={r.id} className="member-report">
                        <StatusBadge status={r.status} />
                        {r.points !== null && <span className="category-points-badge"> Баллы: {r.points}</span>}
                        <span className="member-report-date">{formatMskDate(r.created_at)} МСК</span>
                        <p className="hint-text">
                          Инструктор: {formatFullNameAtRank(r.author, r.author_rank)} · Обучаемый:{" "}
                          {r.target_username || "—"}
                        </p>
                        <p className="member-report-content">{r.content}</p>
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          )}
        </div>
      )}

      {canManageBans && (
        <div className="regiment-panel">
          <h3>
            Запрет на обучение
            <InfoHint text="Временно (до даты) или навсегда запретить бойцу обучение на конкретную специализацию — либо на любое обучение вообще, если специализация не выбрана." />
          </h3>

          <p className="member-list-group-title">Сейчас в блоке ({activeBans.length})</p>
          {activeBans.length === 0 ? (
            <p className="hint-text">Сейчас никто не в блоке.</p>
          ) : (
            <ul className="member-report-list">
              {activeBans.map((b) => (
                <li key={b.id}>
                  <span>
                    <strong>{formatFullName(b.user)}</strong> —{" "}
                    {b.specialization ? `${b.specialization.code} — ${b.specialization.name}` : "всё обучение"}{" "}
                    <span className="error-text">{b.until_date ? `до ${b.until_date}` : "навсегда"}</span>
                  </span>
                  {b.reason && <p className="member-report-content">{b.reason}</p>}
                  <button className="ghost" onClick={() => handleDeleteActiveBan(b)}>
                    Снять
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="add-category-form">
            <select value={banRegimentId} onChange={(e) => setBanRegimentId(e.target.value)}>
              <option value="">— формирование —</option>
              {creatableRegiments.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
            <MemberSearchPicker members={banMembers} selectedId={banTargetDiscordId} onSelect={setBanTargetDiscordId} />
          </div>

          {banTargetDiscordId && (
            <>
              {targetBans.length > 0 && (
                <ul className="member-report-list">
                  {targetBans.map((b) => {
                    const isActive = !b.until_date || new Date(b.until_date) >= new Date(new Date().toDateString());
                    return (
                      <li key={b.id}>
                        <span className={isActive ? "error-text" : "hint-text"}>
                          {b.specialization ? `${b.specialization.code} — ${b.specialization.name}` : "Всё обучение"}{" "}
                          {b.until_date ? `до ${b.until_date}` : "навсегда"}
                          {!isActive && " (истёк)"}
                        </span>
                        {b.reason && <p className="member-report-content">{b.reason}</p>}
                        <button className="ghost" onClick={() => handleDeleteBan(b.id)}>
                          Снять
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="add-category-form">
                <select value={banSpecializationId} onChange={(e) => setBanSpecializationId(e.target.value)}>
                  {access?.is_admin && <option value="">— всё обучение —</option>}
                  {banSpecializationOptions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code} — {s.name}
                    </option>
                  ))}
                </select>
                <input
                  type="date"
                  value={banUntilDate}
                  onChange={(e) => setBanUntilDate(e.target.value)}
                  disabled={banPermanent}
                />
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={banPermanent}
                    onChange={(e) => {
                      setBanPermanent(e.target.checked);
                      if (e.target.checked) setBanUntilDate("");
                    }}
                  />
                  Навсегда
                </label>
                <input
                  type="text"
                  placeholder="Причина (необязательно)"
                  value={banReason}
                  onChange={(e) => setBanReason(e.target.value)}
                />
                <button type="button" disabled={!banPermanent && !banUntilDate} onClick={handleCreateBan}>
                  Запретить обучение
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {access?.is_admin && (
        <div className="regiment-panel">
          <h3>Активность инструкторов</h3>
          <p className="hint-text">Сколько специализаций выдал каждый инструктор/администратор — для контроля нагрузки.</p>
          <div className="reports-toolbar reports-toolbar-filters">
            <select value={activityPeriod} onChange={(e) => setActivityPeriod(e.target.value)}>
              <option value="all">За всё время</option>
              <option value="month">За месяц</option>
              <option value="week">За неделю</option>
            </select>
          </div>
          {instructorActivity.length === 0 ? (
            <EmptyState text="Пока никто ничего не выдавал." />
          ) : (
            <div className="bar-chart">
              {instructorActivity.map((a) => (
                <div key={a.instructor.id} className="bar-chart-row">
                  <span className="bar-chart-label" title={formatFullName(a.instructor)}>
                    {formatFullName(a.instructor)}
                  </span>
                  <span className="bar-chart-track">
                    <span
                      className="bar-chart-fill"
                      style={{ width: `${maxGrantsCount > 0 ? (a.grants_count / maxGrantsCount) * 100 : 0}%` }}
                    />
                  </span>
                  <span className="bar-chart-value">{a.grants_count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="regiment-panel">
        <h3>Ограничения по составам</h3>
        <p className="hint-text">
          Сколько специализаций каждой категории может держать одновременно боец состава.
        </p>
        <div className="roster-table-wrap roster-table-wrap-full">
          <table className="roster-table roster-table-full">
            <thead>
              <tr>
                <th>Состав</th>
                {TIER_LIMIT_FIELDS.map(([field, category]) => (
                  <th key={field}>{CATEGORY_LABELS[category] || category}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayTiers.map((tier) => (
                <tr key={tier.id}>
                  <td>{tier.name}</td>
                  {TIER_LIMIT_FIELDS.map(([field]) => (
                    <td key={field}>{formatLimitCell(tier[field])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
