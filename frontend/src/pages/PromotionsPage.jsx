import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { PageLoading } from "../components/PageLoading";
import { PromotionReviewModal } from "../components/PromotionReviewModal";
import { SaveBar } from "../components/SaveBar";
import { useToast } from "../components/ToastContext";
import { formatFullName } from "../utils/formatName";

const ALL_REGIMENTS = "__all__";

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
  const [categories, setCategories] = useState({});
  const [categoryRequirements, setCategoryRequirements] = useState([]);
  const [baseline, setBaseline] = useState(null);
  const [adminDraft, setAdminDraft] = useState({});
  const [cmdDraft, setCmdDraft] = useState({});
  const [tierDraft, setTierDraft] = useState({});
  const [rankTenureDraft, setRankTenureDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const [mandRankId, setMandRankId] = useState("");
  const [mandCategoryName, setMandCategoryName] = useState("");
  const [mandFields, setMandFields] = useState("");
  const [mandCount, setMandCount] = useState(1);
  const [localRankId, setLocalRankId] = useState("");
  const [localCategoryId, setLocalCategoryId] = useState("");
  const [localCount, setLocalCount] = useState(1);

  const ranks = useMemo(() => tiers.flatMap((t) => t.ranks), [tiers]);
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

  function applyLoaded(tiersData, reqData) {
    const admin = Object.fromEntries(reqData.map((r) => [r.rank_id, r.admin_points_required]));
    const cmd = Object.fromEntries(reqData.map((r) => [r.rank_id, r.points_required]));
    const tier = Object.fromEntries(tiersData.map((t) => [t.id, t.tenure_days_required ?? ""]));
    const rankTenure = Object.fromEntries(
      tiersData.flatMap((t) => t.ranks).map((r) => [r.id, r.tenure_days_required ?? ""])
    );
    setTiers(tiersData);
    setAdminDraft(admin);
    setCmdDraft(cmd);
    setTierDraft(tier);
    setRankTenureDraft(rankTenure);
    setBaseline({ admin, cmd, tier, rankTenure });
  }

  // В режиме "Все формирования" баллы/требования по категориям берём с первого
  // реального формирования как ориентир (командирская надбавка не показывается —
  // это не имеет смысла без конкретного формирования)
  const referenceRegimentId = isAllMode ? allRegiments[0]?.id : regimentId;

  function load() {
    Promise.all([api.getRanks(token), api.getPromotionRequirements(token, referenceRegimentId)]).then(
      ([tiersData, reqData]) => applyLoaded(tiersData, reqData)
    );
    if (referenceRegimentId) {
      api.listCategories(token, referenceRegimentId).then((data) => {
        setCategories(Object.fromEntries(data.map((c) => [c.id, c])));
      });
      api.getCategoryRequirements(token, referenceRegimentId).then(setCategoryRequirements);
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
      JSON.stringify(rankTenureDraft) !== JSON.stringify(baseline.rankTenure));

  function handleReset() {
    if (!baseline) return;
    setAdminDraft(baseline.admin);
    setCmdDraft(baseline.cmd);
    setTierDraft(baseline.tier);
    setRankTenureDraft(baseline.rankTenure);
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

  async function handleAddMandatory(e) {
    e.preventDefault();
    if (!mandRankId || !mandCategoryName.trim()) return;
    setError(null);
    try {
      const fields = mandFields
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((name) => ({ name, type: "text" }));
      await api.createMandatoryCategoryRequirement(token, {
        rankId: Number(mandRankId),
        categoryName: mandCategoryName.trim(),
        categoryFields: fields,
        countRequired: Number(mandCount) || 1,
      });
      setMandCategoryName("");
      setMandFields("");
      setMandCount(1);
      load();
    } catch (e) {
      setError(e.message);
    }
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
                          {req.is_mandatory && <span className="tag-mandatory">обязательное</span>}
                          {((req.is_mandatory && canEditDays) || (!req.is_mandatory && canEditPoints && !isAllMode)) && (
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
        <form onSubmit={handleAddMandatory} className="add-category-form">
          <select value={mandRankId} onChange={(e) => setMandRankId(e.target.value)}>
            <option value="">— звание —</option>
            {ranks.map((r) => (
              <option key={r.id} value={r.id}>
                {r.code} — {r.name}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Название категории (существующей или новой)"
            value={mandCategoryName}
            onChange={(e) => setMandCategoryName(e.target.value)}
          />
          <input
            type="text"
            placeholder="Поля новой категории через запятую (если создаётся впервые)"
            value={mandFields}
            onChange={(e) => setMandFields(e.target.value)}
          />
          <input
            type="number"
            min={1}
            value={mandCount}
            onChange={(e) => setMandCount(e.target.value)}
            style={{ width: "5rem" }}
          />
          <button type="submit">Добавить обязательное требование (во все формирования)</button>
        </form>
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
  const [previewAsSoldier, setPreviewAsSoldier] = useState(false);

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
    await api.approvePromotionRequest(token, id);
    await loadRequests();
  }

  async function handleReject(id) {
    await api.rejectPromotionRequest(token, id);
    await loadRequests();
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
      {previewAsSoldier && (
        <p className="hint-text">
          Вы видите требования так же, как их видит обычный боец — без полей редактирования.
        </p>
      )}

      {error && <p className="error-text">{error}</p>}

      {requests.length > 0 && !previewAsSoldier && (
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
