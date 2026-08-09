import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { MandatoryRequirementModal } from "../components/MandatoryRequirementModal";
import { PageLoading } from "../components/PageLoading";
import { PromotionReviewModal } from "../components/PromotionReviewModal";
import { SaveBar } from "../components/SaveBar";
import { useToast } from "../components/ToastContext";
import { InfoHint } from "../components/Tooltip";
import { formatFullName } from "../utils/formatName";

const ALL_REGIMENTS = "__all__";

const TIER_LIMIT_FIELDS = [
  ["class_limit", "Общих классов"],
  ["gear_limit", "Общего снаряжения"],
  ["specialization_limit", "Общих специализаций"],
  ["additional_specialization_limit", "Доп. специализаций"],
  ["elite_specialization_limit", "Элитных специализаций"],
  ["medic_limit", "Медицинских дисциплин"],
  ["pilot_limit", "Пилотских дисциплин"],
  ["engineer_limit", "Инженерных дисциплин"],
];

function toNum(v) {
  return v === "" || v == null ? 0 : Number(v);
}

/** Требования по баллам + выслуге + категориям — всё под одним званием, а не
 * разнесено по отдельным главам. Обычный боец видит только итоговую цифру, без
 * разбивки на админскую базу и командирскую надбавку — это внутренняя кухня. */
function RequirementsTable({ regimentId, allRegiments, canEditPoints, canEditDays }) {
  const { token } = useAuth();
  const showToast = useToast();
  const isAllMode = regimentId === ALL_REGIMENTS;

  const [tiers, setTiers] = useState([]);
  const [allRanks, setAllRanks] = useState([]);
  const [categories, setCategories] = useState({});
  const [categoryRequirements, setCategoryRequirements] = useState([]);
  const [baseline, setBaseline] = useState(null);
  const [adminDraft, setAdminDraft] = useState({});
  const [cmdDraft, setCmdDraft] = useState({});
  const [tierDraft, setTierDraft] = useState({});
  const [tierLimitsDraft, setTierLimitsDraft] = useState({});
  const [rankTenureDraft, setRankTenureDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  // Защита от гонки: если формирование переключили в <select>, пока летели старые
  // запросы, их устаревшие ответы не должны затереть уже актуальные данные
  const requestIdRef = useRef(0);

  const [mandatoryModalOpen, setMandatoryModalOpen] = useState(false);
  const [editingMandatory, setEditingMandatory] = useState(null);
  const [localRankId, setLocalRankId] = useState("");
  const [localCategoryId, setLocalCategoryId] = useState("");
  const [localCount, setLocalCount] = useState(1);

  const ranks = useMemo(() => tiers.flatMap((t) => t.ranks), [tiers]);
  const startingRank = useMemo(() => {
    if (isAllMode) return null;
    const regiment = allRegiments.find((r) => r.id === regimentId);
    if (!regiment?.starting_rank_id) return null;
    return allRanks.find((r) => r.id === regiment.starting_rank_id) || null;
  }, [isAllMode, allRegiments, regimentId, allRanks]);
  const requirementsByRankId = useMemo(() => {
    const map = new Map();
    for (const req of categoryRequirements) {
      if (!map.has(req.rank_id)) map.set(req.rank_id, []);
      map.get(req.rank_id).push(req);
    }
    return map;
  }, [categoryRequirements]);
  const selectableCategories = useMemo(
    () => Object.values(categories).filter((c) => !c.is_detention),
    [categories]
  );
  // shown as one summary table since these apply across all regiments
  const mandatoryRequirements = useMemo(
    () => categoryRequirements.filter((r) => r.is_mandatory),
    [categoryRequirements]
  );
  const mandatoryCategoryNames = useMemo(
    () => [...new Set(mandatoryRequirements.map((r) => categories[r.category_id]?.name).filter(Boolean))],
    [mandatoryRequirements, categories]
  );

  function applyLoaded(tiersDataRaw, reqData) {
    // jedi tiers excluded, separate promotion system
    const tiersData = tiersDataRaw.filter((t) => !t.is_jedi);
    setAllRanks(tiersDataRaw.flatMap((t) => t.ranks));
    const admin = Object.fromEntries(reqData.map((r) => [r.rank_id, r.admin_points_required]));
    const cmd = Object.fromEntries(reqData.map((r) => [r.rank_id, r.points_required]));
    const tier = Object.fromEntries(tiersData.map((t) => [t.id, t.tenure_days_required ?? ""]));
    const rankTenure = Object.fromEntries(
      tiersData.flatMap((t) => t.ranks).map((r) => [r.id, r.tenure_days_required ?? ""])
    );
    const tierLimits = Object.fromEntries(
      tiersData.map((t) => [
        t.id,
        Object.fromEntries(TIER_LIMIT_FIELDS.map(([field]) => [field, t[field] ?? ""])),
      ])
    );
    setTiers(tiersData);
    setAdminDraft(admin);
    setCmdDraft(cmd);
    setTierDraft(tier);
    setRankTenureDraft(rankTenure);
    setTierLimitsDraft(tierLimits);
    setBaseline({ admin, cmd, tier, rankTenure, tierLimits });
  }

  // В режиме "Все формирования" баллы/требования по категориям берём с первого
  // реального формирования как ориентир (командирская надбавка не показывается —
  // это не имеет смысла без конкретного формирования)
  const referenceRegimentId = isAllMode ? allRegiments[0]?.id : regimentId;

  function load() {
    const requestId = ++requestIdRef.current;
    Promise.all([api.getRanks(token), api.getPromotionRequirements(token, referenceRegimentId)])
      .then(([tiersData, reqData]) => {
        if (requestIdRef.current === requestId) applyLoaded(tiersData, reqData);
      })
      .catch((e) => {
        if (requestIdRef.current === requestId) setError(e.message);
      });
    if (referenceRegimentId) {
      api
        .listCategories(token, referenceRegimentId)
        .then((data) => {
          if (requestIdRef.current === requestId) {
            setCategories(Object.fromEntries(data.map((c) => [c.id, c])));
          }
        })
        .catch((e) => {
          if (requestIdRef.current === requestId) setError(e.message);
        });
      api
        .getCategoryRequirements(token, referenceRegimentId)
        .then((data) => {
          if (requestIdRef.current === requestId) setCategoryRequirements(data);
        })
        .catch((e) => {
          if (requestIdRef.current === requestId) setError(e.message);
        });
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, referenceRegimentId]);

  const isDirty =
    baseline != null &&
    (JSON.stringify(adminDraft) !== JSON.stringify(baseline.admin) ||
      JSON.stringify(cmdDraft) !== JSON.stringify(baseline.cmd) ||
      JSON.stringify(tierDraft) !== JSON.stringify(baseline.tier) ||
      JSON.stringify(rankTenureDraft) !== JSON.stringify(baseline.rankTenure) ||
      JSON.stringify(tierLimitsDraft) !== JSON.stringify(baseline.tierLimits));

  function handleReset() {
    if (!baseline) return;
    setAdminDraft(baseline.admin);
    setCmdDraft(baseline.cmd);
    setTierDraft(baseline.tier);
    setRankTenureDraft(baseline.rankTenure);
    setTierLimitsDraft(baseline.tierLimits);
    setError(null);
  }

  async function handleSaveAll() {
    setSaving(true);
    setError(null);
    try {
      if (canEditPoints && !isAllMode) {
        const items = Object.entries(cmdDraft).map(([rankId, points]) => ({
          rank_id: Number(rankId),
          points_required: toNum(points),
        }));
        await api.updatePromotionRequirements(token, regimentId, items);
      }
      if (canEditDays) {
        const adminItems = Object.entries(adminDraft).map(([rankId, points]) => ({
          rank_id: Number(rankId),
          points_required: toNum(points),
        }));
        const regimentIds = isAllMode ? null : [regimentId];
        await api.updateAdminPointsRequired(token, adminItems, regimentIds);

        for (const [tierId, value] of Object.entries(tierDraft)) {
          if (value === baseline.tier[tierId]) continue;
          await api.updateTierTenure(token, tierId, value === "" ? null : Number(value));
        }
        for (const [rankId, value] of Object.entries(rankTenureDraft)) {
          if (value === baseline.rankTenure[rankId]) continue;
          await api.updateRankTenure(token, rankId, value === "" ? null : Number(value));
        }
        for (const [tierId, limits] of Object.entries(tierLimitsDraft)) {
          if (JSON.stringify(limits) === JSON.stringify(baseline.tierLimits[tierId])) continue;
          const payload = Object.fromEntries(
            Object.entries(limits).map(([field, value]) => [field, value === "" ? null : Number(value)])
          );
          await api.updateTierSpecializationLimits(token, tierId, payload);
        }
      }
      load();
      showToast(isAllMode ? "Применено ко всем формированиям" : "Изменения сохранены");
    } catch (e) {
      setError(e.message);
      showToast(e.message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddLocal(e) {
    e.preventDefault();
    if (!localRankId || !localCategoryId || isAllMode) return;
    setError(null);
    try {
      await api.createLocalCategoryRequirement(token, regimentId, {
        rankId: Number(localRankId),
        categoryId: Number(localCategoryId),
        countRequired: Number(localCount) || 1,
      });
      setLocalRankId("");
      setLocalCategoryId("");
      setLocalCount(1);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  function openCreateMandatory() {
    setEditingMandatory(null);
    setMandatoryModalOpen(true);
  }

  function openEditMandatory(req) {
    const category = categories[req.category_id];
    setEditingMandatory({
      groupId: req.mandatory_group_id,
      rankId: req.rank_id,
      categoryName: category?.name || "",
      fields: category?.fields || [],
      countRequired: req.count_required,
      minRankId: category?.min_rank?.id ?? "",
      commanderOnly: category?.commander_only ?? false,
    });
    setMandatoryModalOpen(true);
  }

  async function handleDeleteRequirement(id) {
    setError(null);
    try {
      await api.deleteCategoryRequirement(token, id);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  if (baseline == null) return <p>Загрузка...</p>;

  return (
    <div className="regiment-panel">
      {isAllMode && (
        <p className="hint-text">
          Режим "Все формирования": здесь можно разом выставить админскую базу баллов, выслугу и обязательные
          требования по категориям сразу для всех формирований.
        </p>
      )}

      {startingRank && (
        <p className="hint-text">
          Набор в это формирование — со звания <strong>{startingRank.code} — {startingRank.name}</strong>
        </p>
      )}

      {tiers.map((tier) => (
        <div key={tier.id} className="member-list-group">
          <p className="member-list-group-title">
            {tier.name}
            {canEditDays ? (
              <span className="points-inline">
                — дней выслуги (по составу):
                <input
                  type="number"
                  value={tierDraft[tier.id] ?? ""}
                  onChange={(e) => setTierDraft((prev) => ({ ...prev, [tier.id]: e.target.value }))}
                  placeholder="не указано"
                />
              </span>
            ) : (
              tier.tenure_days_required != null && ` — дней выслуги: ${tier.tenure_days_required}`
            )}
          </p>
          {canEditDays && (
            <div className="tier-limits-row">
              {TIER_LIMIT_FIELDS.map(([field, label]) => (
                <label key={field} className="points-inline">
                  {label}:
                  <InfoHint text="Сколько специализаций этой категории может держать одновременно боец этого состава — пусто значит без ограничений." />
                  <input
                    type="number"
                    min="0"
                    value={tierLimitsDraft[tier.id]?.[field] ?? ""}
                    onChange={(e) =>
                      setTierLimitsDraft((prev) => ({
                        ...prev,
                        [tier.id]: { ...prev[tier.id], [field]: e.target.value },
                      }))
                    }
                    placeholder="∞"
                  />
                </label>
              ))}
            </div>
          )}
          <ul className="category-list">
            {tier.ranks.map((rank) => {
              const rankRequirements = requirementsByRankId.get(rank.id) || [];
              return (
                <li key={rank.id} className="rank-requirement-card">
                  <div className="rank-requirement-row">
                    <strong>{rank.code} — {rank.name}</strong>
                    {canEditDays && !isAllMode && (
                      <span className="points-inline">
                        админ. база:
                        <InfoHint text="Баллы за это звание, которые выставляет администратор/высшее командование — база, не зависящая от командира формирования." />
                        <input
                          type="number"
                          value={adminDraft[rank.id] ?? ""}
                          onChange={(e) => setAdminDraft((prev) => ({ ...prev, [rank.id]: e.target.value }))}
                          placeholder="0"
                        />
                      </span>
                    )}
                    {isAllMode && canEditDays && (
                      <span className="points-inline">
                        баллы (для всех):
                        <InfoHint text="Применится сразу ко всем формированиям — тот же смысл, что и «админ. база»." />
                        <input
                          type="number"
                          value={adminDraft[rank.id] ?? ""}
                          onChange={(e) => setAdminDraft((prev) => ({ ...prev, [rank.id]: e.target.value }))}
                          placeholder="0"
                        />
                      </span>
                    )}
                    {!isAllMode && canEditPoints && (
                      <span className="points-inline">
                        + от командира:
                        <InfoHint text="Надбавка к «админ. базе» — задаётся командиром этого формирования, суммируется в «Всего баллов»." />
                        <input
                          type="number"
                          value={cmdDraft[rank.id] ?? ""}
                          onChange={(e) => setCmdDraft((prev) => ({ ...prev, [rank.id]: e.target.value }))}
                          placeholder="0"
                        />
                      </span>
                    )}
                    {!isAllMode && (
                      <span className="category-points-badge">
                        Всего баллов: {toNum(baseline.admin[rank.id]) + toNum(baseline.cmd[rank.id])}
                      </span>
                    )}
                    {canEditDays && (
                      <span className="points-inline">
                        · своя выслуга:
                        <InfoHint text="Переопределяет для конкретного звания, сколько дней нужно провести в нём — если оставить пустым, действует общее значение состава, указанное выше." />
                        <input
                          type="number"
                          value={rankTenureDraft[rank.id] ?? ""}
                          onChange={(e) => setRankTenureDraft((prev) => ({ ...prev, [rank.id]: e.target.value }))}
                          placeholder="как у состава"
                        />
                      </span>
                    )}
                  </div>

                  {rankRequirements.length > 0 && (
                    <ul className="category-list category-list-nested">
                      {rankRequirements.map((req) => (
                        <li key={req.id}>
                          {categories[req.category_id]?.name || `#${req.category_id}`} — нужно {req.count_required}
                          {req.is_mandatory && (
                            <span className="hint-text"> (обязательно, для всех формирований)</span>
                          )}
                          {req.is_mandatory && canEditDays && (
                            <button className="ghost" onClick={() => openEditMandatory(req)}>
                              Изменить
                            </button>
                          )}
                          {(req.is_mandatory ? canEditDays : canEditPoints && !isAllMode) && (
                            <button className="ghost" onClick={() => handleDeleteRequirement(req.id)}>
                              Удалить
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {error && <p className="error-text">{error}</p>}

      {canEditPoints && !isAllMode && (
        <form onSubmit={handleAddLocal} className="add-category-form">
          <select value={localRankId} onChange={(e) => setLocalRankId(e.target.value)}>
            <option value="">— звание —</option>
            {ranks.map((r) => (
              <option key={r.id} value={r.id}>
                {r.code} — {r.name}
              </option>
            ))}
          </select>
          <select value={localCategoryId} onChange={(e) => setLocalCategoryId(e.target.value)}>
            <option value="">— категория —</option>
            {selectableCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={1}
            value={localCount}
            onChange={(e) => setLocalCount(e.target.value)}
            style={{ width: "5rem" }}
          />
          <button type="submit">Добавить своё требование по категории</button>
        </form>
      )}

      {canEditDays && (
        <div className="report-form-actions">
          <button type="button" onClick={openCreateMandatory}>
            + Обязательное требование (для всех формирований)
          </button>
        </div>
      )}

      {mandatoryModalOpen && (
        <MandatoryRequirementModal
          ranks={ranks}
          existingCategoryNames={mandatoryCategoryNames}
          initial={editingMandatory}
          onClose={() => setMandatoryModalOpen(false)}
          onSaved={() => {
            setMandatoryModalOpen(false);
            load();
          }}
        />
      )}

      {selectableCategories.length > 0 && (
        <div className="member-list-group category-points-summary">
          <p className="member-list-group-title">Баллы за рапорты по категориям</p>
          <div className="table-scroll">
            <table className="category-points-table">
              <thead>
                <tr>
                  <th>Категория</th>
                  <th>Автору рапорта</th>
                  <th>Участникам (состав)</th>
                </tr>
              </thead>
              <tbody>
                {selectableCategories.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td className="mono-num">{c.points ?? "—"}</td>
                    <td className="mono-num">{c.participant_points ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <SaveBar
        visible={isDirty}
        saving={saving}
        label={isAllMode ? "Есть несохранённые изменения — применятся ко всем формированиям" : "Есть несохранённые изменения по требованиям повышения"}
        onSave={handleSaveAll}
        onReset={handleReset}
      />
    </div>
  );
}

export function PromotionsPage() {
  const { token, access, regiments } = useAuth();
  const [requests, setRequests] = useState([]);
  const [regimentId, setRegimentId] = useState("");
  const [reviewRequestId, setReviewRequestId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [previewAsSoldier, setPreviewAsSoldier] = useState(true);

  const isAdminOrHighCommand = access?.is_admin || access?.is_high_command;

  const visibleRegiments = useMemo(() => {
    if (isAdminOrHighCommand) return regiments;
    const ids = new Set([...(access?.commander_regiment_ids || []), ...(access?.soldier_regiment_ids || [])]);
    return regiments.filter((r) => ids.has(r.id));
  }, [access, regiments, isAdminOrHighCommand]);

  useEffect(() => {
    if (!regimentId && visibleRegiments.length > 0) setRegimentId(visibleRegiments[0].id);
  }, [visibleRegiments, regimentId]);

  async function loadRequests() {
    try {
      setRequests(await api.listPromotionRequests(token));
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    loadRequests()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleApprove(id) {
    try {
      await api.approvePromotionRequest(token, id);
      await loadRequests();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleReject(id) {
    try {
      await api.rejectPromotionRequest(token, id);
      await loadRequests();
    } catch (e) {
      setError(e.message);
    }
  }

  if (loading) return <PageLoading />;

  const canEditPointsReal =
    regimentId !== ALL_REGIMENTS &&
    (access?.is_admin || access?.is_high_command || (access?.category_manager_regiment_ids || []).includes(Number(regimentId)));
  const canEditDaysReal = access?.is_admin || access?.is_high_command;
  const isEditor = canEditPointsReal || canEditDaysReal;
  const canEditPoints = canEditPointsReal && !previewAsSoldier;
  const canEditDays = canEditDaysReal && !previewAsSoldier;

  return (
    <div className="promotions-page">
      <div className="reports-toolbar">
        <h2>Система повышений</h2>
        {isEditor && (
          <button className="ghost" onClick={() => setPreviewAsSoldier((v) => !v)}>
            {previewAsSoldier ? "Режим редактора" : "Просмотр как боец"}
          </button>
        )}
      </div>
      {error && <p className="error-text">{error}</p>}

      {requests.length > 0 && (
        <>
          <h3>Заявки на повышение</h3>
          <div className="report-list">
            {requests.map((r) => (
              <div key={r.id} className="report-row">
                <div className="report-row-header">
                  <span className="report-regiment">{formatFullName(r.user)}</span>
                  <span className="report-category">
                    {r.from_rank?.code || "—"} → {r.to_rank.code}
                  </span>
                </div>
                <div className="report-row-actions">
                  <button onClick={() => setReviewRequestId(r.id)}>Просмотреть повышение</button>
                  <button className="primary" onClick={() => handleApprove(r.id)}>
                    Одобрить
                  </button>
                  <button onClick={() => handleReject(r.id)}>Отклонить</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {(visibleRegiments.length > 1 || isAdminOrHighCommand) && (
        <label>
          Формирование
          <select value={regimentId} onChange={(e) => setRegimentId(e.target.value)}>
            {visibleRegiments.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
            {isAdminOrHighCommand && <option value={ALL_REGIMENTS}>— Все формирования —</option>}
          </select>
        </label>
      )}

      {regimentId && (
        <RequirementsTable
          regimentId={regimentId === ALL_REGIMENTS ? ALL_REGIMENTS : Number(regimentId)}
          allRegiments={regiments}
          canEditPoints={canEditPoints}
          canEditDays={canEditDays}
        />
      )}

      {reviewRequestId && (
        <PromotionReviewModal requestId={reviewRequestId} onClose={() => setReviewRequestId(null)} />
      )}
    </div>
  );
}
