import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { MultiSelectDropdown } from "../components/MultiSelectDropdown";
import { SaveBar } from "../components/SaveBar";
import { useToast } from "../components/ToastContext";
import { formatMskDate } from "../utils/formatDate";
import { SPECIALIZATION_CATEGORIES } from "../utils/specialization";

/** Админ-панель ("God mode") — правки, недоступные обычному командиру/заместителю:
 * выговоры любому бойцу, ручная правка выслуги (дней в звании), смена ника/звания/ИДН,
 * ручное переопределение категорийных требований по повышению. Строго is_admin. */
function profileSnapshot(member) {
  return {
    serviceId: member?.service_id || "",
    callsign: member?.callsign || "",
    steamId: member?.steam_id || "",
    rankId: member?.rank?.id ?? "",
    jediTitleId: member?.jedi_title?.id ?? "",
  };
}

export function AdminPanelPage() {
  const { token, regiments } = useAuth();
  const showToast = useToast();
  const navigate = useNavigate();
  const [regimentId, setRegimentId] = useState(regiments[0]?.id ?? "");
  const [members, setMembers] = useState([]);
  const [discordId, setDiscordId] = useState("");
  const [tiers, setTiers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [requirements, setRequirements] = useState([]);

  const ranksById = Object.fromEntries(tiers.flatMap((t) => t.ranks).map((r) => [r.id, r]));
  const categoriesById = Object.fromEntries(categories.map((c) => [c.id, c]));
  const currentRegiment = regiments.find((r) => r.id === Number(regimentId));

  const [profileBaseline, setProfileBaseline] = useState(profileSnapshot(null));
  const [serviceId, setServiceId] = useState("");
  const [callsign, setCallsign] = useState("");
  const [steamId, setSteamId] = useState("");
  const [rankId, setRankId] = useState("");
  const [jediTitleId, setJediTitleId] = useState("");
  const [earlyPromotionReason, setEarlyPromotionReason] = useState("");
  const [daysInRank, setDaysInRank] = useState("");

  const [adjustmentPoints, setAdjustmentPoints] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");

  const [reprimandReason, setReprimandReason] = useState("");
  const [reprimandSeverity, setReprimandSeverity] = useState("strict");
  const [reprimandPoints, setReprimandPoints] = useState("");

  const [overrideRequirementId, setOverrideRequirementId] = useState("");
  const [overrideSatisfied, setOverrideSatisfied] = useState(true);

  const [maintenanceEnabled, setMaintenanceEnabled] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState("");

  const [characters, setCharacters] = useState([]);
  const [newCharRegimentId, setNewCharRegimentId] = useState("");
  const [newCharServiceId, setNewCharServiceId] = useState("");
  const [newCharCallsign, setNewCharCallsign] = useState("");
  const [newCharRankId, setNewCharRankId] = useState("");
  const [newCharSteamId, setNewCharSteamId] = useState("");
  const [newCharIsJedi, setNewCharIsJedi] = useState(false);
  const [editingCharId, setEditingCharId] = useState(null);
  const [editCharServiceId, setEditCharServiceId] = useState("");
  const [editCharCallsign, setEditCharCallsign] = useState("");
  const [editCharRankId, setEditCharRankId] = useState("");
  const [editCharSteamId, setEditCharSteamId] = useState("");
  const [editCharIsJedi, setEditCharIsJedi] = useState(false);

  const [specializations, setSpecializations] = useState([]);
  const [newSpecCode, setNewSpecCode] = useState("");
  const [newSpecName, setNewSpecName] = useState("");
  const [newSpecCategory, setNewSpecCategory] = useState("specialization");
  const [newSpecMinRankId, setNewSpecMinRankId] = useState("");
  const [newSpecParentId, setNewSpecParentId] = useState("");
  const [newSpecRequiredRegimentId, setNewSpecRequiredRegimentId] = useState("");
  const [newSpecPrerequisiteIds, setNewSpecPrerequisiteIds] = useState([]);
  const [newSpecIsSingleton, setNewSpecIsSingleton] = useState(false);
  const [editingSpecId, setEditingSpecId] = useState(null);
  const [editSpecCode, setEditSpecCode] = useState("");
  const [editSpecName, setEditSpecName] = useState("");
  const [editSpecMinRankId, setEditSpecMinRankId] = useState("");
  const [editSpecParentId, setEditSpecParentId] = useState("");
  const [editSpecRequiredRegimentId, setEditSpecRequiredRegimentId] = useState("");
  const [editSpecPrerequisiteIds, setEditSpecPrerequisiteIds] = useState([]);
  const [editSpecIsSingleton, setEditSpecIsSingleton] = useState(false);

  const [systemHealth, setSystemHealth] = useState(null);
  const [healthStaleDays, setHealthStaleDays] = useState(3);

  const [inactiveMembers, setInactiveMembers] = useState([]);
  const [reinstatingDiscordId, setReinstatingDiscordId] = useState(null);

  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const memberRequestIdRef = useRef(0);
  const characterRequestIdRef = useRef(0);

  function loadSpecializations() {
    api.listSpecializations(token).then(setSpecializations).catch(() => setSpecializations([]));
  }

  useEffect(() => {
    api.getRanks(token).then(setTiers).catch(() => setTiers([]));
    api
      .getMaintenanceStatus()
      .then((s) => {
        setMaintenanceEnabled(s.enabled);
        setMaintenanceMessage(s.message || "");
      })
      .catch(() => {});
    loadSpecializations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  function loadHealth(staleDays = healthStaleDays) {
    api.getSystemHealth(token, staleDays).then(setSystemHealth).catch(() => setSystemHealth(null));
  }

  useEffect(() => {
    loadHealth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  function loadInactiveMembers() {
    api.getInactiveMembers(token).then(setInactiveMembers).catch(() => setInactiveMembers([]));
  }

  useEffect(() => {
    loadInactiveMembers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function handleReinstate(m) {
    // Разжалованный числится "в составе" сразу нескольких формирований, только
    // если у него совпало несколько Discord-ролей одновременно (редкость) —
    // берём первое найденное, этого достаточно, чтобы снять is_inactive
    // (сама отметка глобальная на User, не привязана к конкретному формированию)
    const regimentId = m.regiment_ids[0];
    setReinstatingDiscordId(m.discord_id);
    setError(null);
    try {
      await api.setMemberProfile(token, regimentId, m.discord_id, { is_inactive: false });
      showToast(`${m.username} восстановлен в строй`);
      loadInactiveMembers();
    } catch (e) {
      setError(e.message);
      showToast(e.message, "error");
    } finally {
      setReinstatingDiscordId(null);
    }
  }

  async function handleMaintenanceSave() {
    try {
      await api.updateMaintenance(token, { enabled: maintenanceEnabled, message: maintenanceMessage.trim() || null });
      showToast("Режим обслуживания обновлён", "success");
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleAddSpecialization() {
    if (!newSpecCode.trim() || !newSpecName.trim()) return;
    try {
      await api.createSpecialization(token, {
        code: newSpecCode.trim().toUpperCase(),
        name: newSpecName.trim(),
        category: newSpecCategory,
        minRankId: newSpecMinRankId === "" ? null : Number(newSpecMinRankId),
        requiredRegimentId: newSpecRequiredRegimentId === "" ? null : Number(newSpecRequiredRegimentId),
        parentId: newSpecParentId === "" ? null : Number(newSpecParentId),
        prerequisiteSpecializationIds: newSpecPrerequisiteIds,
        isSingleton: newSpecIsSingleton,
      });
      setNewSpecCode("");
      setNewSpecName("");
      setNewSpecMinRankId("");
      setNewSpecParentId("");
      setNewSpecRequiredRegimentId("");
      setNewSpecPrerequisiteIds([]);
      setNewSpecIsSingleton(false);
      loadSpecializations();
      showToast("Специализация добавлена");
    } catch (e) {
      setError(e.message);
      showToast(e.message, "error");
    }
  }

  function startEditSpecialization(s) {
    setEditingSpecId(s.id);
    setEditSpecCode(s.code);
    setEditSpecName(s.name);
    setEditSpecMinRankId(s.min_rank?.id ?? "");
    setEditSpecParentId(s.parent_id ?? "");
    setEditSpecRequiredRegimentId(s.required_regiment_id ?? "");
    setEditSpecPrerequisiteIds(s.prerequisite_specialization_ids ?? []);
    setEditSpecIsSingleton(s.is_singleton ?? false);
  }

  function cancelEditSpecialization() {
    setEditingSpecId(null);
  }

  async function handleSaveSpecialization(id) {
    if (!editSpecCode.trim() || !editSpecName.trim()) return;
    try {
      await api.updateSpecialization(token, id, {
        code: editSpecCode.trim().toUpperCase(),
        name: editSpecName.trim(),
        minRankId: editSpecMinRankId === "" ? null : Number(editSpecMinRankId),
        requiredRegimentId: editSpecRequiredRegimentId === "" ? null : Number(editSpecRequiredRegimentId),
        parentId: editSpecParentId === "" ? null : Number(editSpecParentId),
        prerequisiteSpecializationIds: editSpecPrerequisiteIds,
        isSingleton: editSpecIsSingleton,
      });
      setEditingSpecId(null);
      loadSpecializations();
      showToast("Специализация обновлена");
    } catch (e) {
      setError(e.message);
      showToast(e.message, "error");
    }
  }

  async function handleDeleteSpecialization(id) {
    try {
      await api.deleteSpecialization(token, id);
      loadSpecializations();
      showToast("Специализация удалена");
    } catch (e) {
      setError(e.message);
      showToast(e.message, "error");
    }
  }

  useEffect(() => {
    if (!regimentId) return;
    const requestId = ++memberRequestIdRef.current;
    api
      .getMembers(token, regimentId)
      .then((data) => {
        if (memberRequestIdRef.current === requestId) setMembers(data);
      })
      .catch(() => {
        if (memberRequestIdRef.current === requestId) setMembers([]);
      });
    api
      .getCategoryRequirements(token, regimentId)
      .then((data) => {
        if (memberRequestIdRef.current === requestId) setRequirements(data);
      })
      .catch(() => {
        if (memberRequestIdRef.current === requestId) setRequirements([]);
      });
    api
      .listCategories(token, regimentId)
      .then((data) => {
        if (memberRequestIdRef.current === requestId) setCategories(data);
      })
      .catch(() => {
        if (memberRequestIdRef.current === requestId) setCategories([]);
      });
    setDiscordId("");
  }, [token, regimentId]);

  const member = members.find((m) => m.discord_id === discordId) || null;

  function loadCharacters() {
    const requestId = ++characterRequestIdRef.current;
    if (!discordId) {
      setCharacters([]);
      return;
    }
    api
      .listCharacters(token, discordId)
      .then((data) => {
        if (characterRequestIdRef.current === requestId) setCharacters(data);
      })
      .catch(() => {
        if (characterRequestIdRef.current === requestId) setCharacters([]);
      });
  }

  useEffect(() => {
    loadCharacters();
    setNewCharRegimentId("");
    setNewCharServiceId("");
    setNewCharCallsign("");
    setNewCharRankId("");
    setNewCharSteamId("");
    setNewCharIsJedi(false);
    setEditingCharId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, discordId]);

  async function handleAddCharacter() {
    if (!newCharRegimentId) return;
    try {
      await api.createCharacter(token, discordId, {
        regimentId: Number(newCharRegimentId),
        serviceId: newCharServiceId.trim(),
        callsign: newCharCallsign.trim(),
        rankId: newCharRankId === "" ? null : Number(newCharRankId),
        steamId: newCharSteamId.trim(),
        isJedi: newCharIsJedi,
      });
      setNewCharRegimentId("");
      setNewCharServiceId("");
      setNewCharCallsign("");
      setNewCharRankId("");
      setNewCharSteamId("");
      setNewCharIsJedi(false);
      loadCharacters();
      showToast("Персонаж добавлен");
    } catch (e) {
      showToast(e.message, "error");
    }
  }

  function startEditCharacter(c) {
    setEditingCharId(c.id);
    setEditCharServiceId(c.service_id || "");
    setEditCharCallsign(c.callsign || "");
    setEditCharRankId(c.rank?.id ?? "");
    setEditCharSteamId(c.steam_id || "");
    setEditCharIsJedi(!!c.is_jedi);
  }

  async function handleSaveCharacter(characterId) {
    try {
      await api.updateCharacter(token, discordId, characterId, {
        serviceId: editCharServiceId.trim() || null,
        callsign: editCharCallsign.trim() || null,
        rankId: editCharRankId === "" ? null : Number(editCharRankId),
        steamId: editCharSteamId.trim() || null,
        isJedi: editCharIsJedi,
      });
      setEditingCharId(null);
      loadCharacters();
      showToast("Персонаж обновлён");
    } catch (e) {
      showToast(e.message, "error");
    }
  }

  async function handleDeleteCharacter(characterId) {
    try {
      await api.deleteCharacter(token, discordId, characterId);
      loadCharacters();
      showToast("Персонаж удалён");
    } catch (e) {
      showToast(e.message, "error");
    }
  }

  useEffect(() => {
    if (!member) return;
    const snapshot = profileSnapshot(member);
    setProfileBaseline(snapshot);
    setServiceId(snapshot.serviceId);
    setCallsign(snapshot.callsign);
    setSteamId(snapshot.steamId);
    setRankId(snapshot.rankId);
    setJediTitleId(snapshot.jediTitleId);
    setDaysInRank(member.days_in_rank ?? "");
  }, [member]);

  const isProfileDirty =
    serviceId !== profileBaseline.serviceId ||
    callsign !== profileBaseline.callsign ||
    steamId !== profileBaseline.steamId ||
    rankId !== profileBaseline.rankId ||
    jediTitleId !== profileBaseline.jediTitleId;

  function handleResetProfile() {
    setServiceId(profileBaseline.serviceId);
    setCallsign(profileBaseline.callsign);
    setSteamId(profileBaseline.steamId);
    setRankId(profileBaseline.rankId);
    setJediTitleId(profileBaseline.jediTitleId);
    setEarlyPromotionReason("");
  }

  function report(fn) {
    return async (...args) => {
      setMessage(null);
      setError(null);
      try {
        await fn(...args);
        setMessage("Готово.");
        showToast("Готово");
      } catch (e) {
        setError(e.message);
        showToast(e.message, "error");
      }
    };
  }

  const handleSaveProfile = report(async () => {
    const rankChanged = rankId !== profileBaseline.rankId;
    const jediTitleChanged = jediTitleId !== profileBaseline.jediTitleId;
    await api.setMemberProfile(token, regimentId, discordId, {
      service_id: serviceId.trim() || null,
      callsign: callsign.trim() || null,
      steam_id: steamId.trim() || null,
      rank_id: rankId === "" ? null : Number(rankId),
      ...(jediTitleChanged ? { jedi_title_id: jediTitleId === "" ? null : Number(jediTitleId) } : {}),
      ...(rankChanged || jediTitleChanged ? { early_promotion_reason: earlyPromotionReason.trim() || null } : {}),
    });
    setProfileBaseline({ serviceId, callsign, steamId, rankId, jediTitleId });
    setEarlyPromotionReason("");
  });

  const handleSaveTenure = report(async () => {
    await api.updateMemberTenure(token, regimentId, discordId, Number(daysInRank));
  });

  const handleIssuePoints = report(async () => {
    if (!adjustmentPoints || !adjustmentReason.trim()) throw new Error("Укажите баллы и причину");
    await api.issuePointsAdjustment(token, regimentId, discordId, {
      points: Number(adjustmentPoints),
      reason: adjustmentReason.trim(),
    });
    setAdjustmentPoints("");
    setAdjustmentReason("");
  });

  const handleIssueReprimand = report(async () => {
    if (!reprimandReason.trim()) throw new Error("Укажите причину");
    await api.issueReprimand(token, regimentId, {
      targetDiscordId: discordId,
      reason: reprimandReason.trim(),
      severity: reprimandSeverity,
      pointsRequired: reprimandPoints ? Number(reprimandPoints) : 0,
    });
    setReprimandReason("");
    setReprimandPoints("");
  });

  const handleOverride = report(async () => {
    if (!overrideRequirementId) throw new Error("Выберите требование");
    await api.overrideCategoryRequirement(token, {
      requirementId: Number(overrideRequirementId),
      targetDiscordId: discordId,
      satisfied: overrideSatisfied,
    });
  });

  return (
    <div className="violations-page">
      <h2>Админ-панель</h2>
      <p className="hint-text">
        Ручные правки для любого бойца любого формирования: выговоры, выслуга, профиль, критерии повышения.
      </p>

      <div className="violations-filters">
        <label className="violation-filter-label">
          Формирование
          <select value={regimentId} onChange={(e) => setRegimentId(e.target.value)}>
            {regiments.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="violation-filter-label">
          Боец
          <select value={discordId} onChange={(e) => setDiscordId(e.target.value)}>
            <option value="">— выбрать —</option>
            {members.map((m) => (
              <option key={m.discord_id} value={m.discord_id}>
                {m.username}
              </option>
            ))}
          </select>
        </label>
      </div>

      {message && <p className="hint-text">{message}</p>}
      {error && <p className="error-text">{error}</p>}

      {member && (
        <>
          <div className="regiment-panel fade-in-up">
            <h4>Профиль</h4>
            <label>
              ИДН
              <input type="text" maxLength={4} value={serviceId} onChange={(e) => setServiceId(e.target.value)} />
            </label>
            <label>
              Позывной (он же веб-ник)
              <input type="text" value={callsign} onChange={(e) => setCallsign(e.target.value)} />
            </label>
            <label>
              Steam ID
              <input type="text" value={steamId} onChange={(e) => setSteamId(e.target.value)} />
            </label>
            <label>
              {currentRegiment?.is_jedi_order ? "Ранг" : "Звание"}
              <select value={rankId} onChange={(e) => setRankId(e.target.value)}>
                <option value="">— не назначено —</option>
                {tiers
                  .filter((tier) =>
                    currentRegiment?.is_jedi_order ? tier.is_jedi_rank_track : !tier.is_jedi
                  )
                  .map((tier) => (
                    <optgroup key={tier.id} label={tier.name}>
                      {tier.ranks.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.code} — {r.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
              </select>
            </label>
            {currentRegiment?.is_jedi_order && (
              <label>
                Звание (CO/SCO/GEN/SGEN/HGEN) — не коррелирует с рангом, только ограничено им сверху
                <select value={jediTitleId} onChange={(e) => setJediTitleId(e.target.value)}>
                  <option value="">— без звания —</option>
                  {tiers
                    .filter((tier) => tier.is_jedi && !tier.is_jedi_rank_track)
                    .map((tier) => (
                      <optgroup key={tier.id} label={tier.name}>
                        {tier.ranks.map((r) => {
                          const rangRank = ranksById[rankId];
                          const ceilingIndex = rangRank?.max_jedi_title_rank_id
                            ? tiers
                                .flatMap((t) => t.ranks)
                                .findIndex((rr) => rr.id === rangRank.max_jedi_title_rank_id)
                            : null;
                          const thisIndex = tiers.flatMap((t) => t.ranks).findIndex((rr) => rr.id === r.id);
                          const disabled = ceilingIndex !== null && thisIndex > ceilingIndex;
                          return (
                            <option key={r.id} value={r.id} disabled={disabled}>
                              {r.code} — {r.name}
                            </option>
                          );
                        })}
                      </optgroup>
                    ))}
                </select>
              </label>
            )}
            {(rankId !== profileBaseline.rankId || jediTitleId !== profileBaseline.jediTitleId) && (
              <label>
                Причина досрочного повышения
                <input
                  type="text"
                  value={earlyPromotionReason}
                  onChange={(e) => setEarlyPromotionReason(e.target.value)}
                  placeholder="например: заслуга в операции"
                />
              </label>
            )}
            {member.early_promoted_by_username && (
              <p className="hint-text">
                Досрочно повысил: {member.early_promoted_by_username}
                {member.early_promotion_reason && ` — ${member.early_promotion_reason}`}
              </p>
            )}
            <SaveBar
              visible={isProfileDirty}
              saving={false}
              label="Есть несохранённые изменения в профиле"
              onSave={handleSaveProfile}
              onReset={handleResetProfile}
            />
          </div>

          <div className="regiment-panel fade-in-up">
            <h4>Персонажи в других формированиях</h4>
            <p className="hint-text">
              Второй игровой персонаж (джедаи и другие, приписанные сразу к нескольким формированиям) — заводится
              и полностью настраивается вручную, не требует реальной Discord-роли этого формирования.
            </p>
            {characters.length > 0 && (
              <ul className="category-list">
                {characters.map((c) =>
                  editingCharId === c.id ? (
                    <li key={c.id} className="rank-requirement-card">
                      <strong>{c.regiment.name}</strong>
                      <div className="add-category-form">
                        <input
                          type="text"
                          placeholder="ИДН"
                          value={editCharServiceId}
                          onChange={(e) => setEditCharServiceId(e.target.value)}
                          style={{ width: "6rem" }}
                        />
                        <input
                          type="text"
                          placeholder="Позывной"
                          value={editCharCallsign}
                          onChange={(e) => setEditCharCallsign(e.target.value)}
                        />
                        <select value={editCharRankId} onChange={(e) => setEditCharRankId(e.target.value)}>
                          <option value="">— звание —</option>
                          {tiers
                            .filter((tier) => (editCharIsJedi ? tier.is_jedi : !tier.is_jedi))
                            .flatMap((tier) =>
                              tier.ranks.map((r) => (
                                <option key={r.id} value={r.id}>
                                  {r.code} — {r.name}
                                </option>
                              ))
                            )}
                        </select>
                        <input
                          type="text"
                          placeholder="Steam ID (необязательно)"
                          value={editCharSteamId}
                          onChange={(e) => setEditCharSteamId(e.target.value)}
                        />
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={editCharIsJedi}
                            onChange={(e) => {
                              setEditCharIsJedi(e.target.checked);
                              setEditCharRankId("");
                            }}
                          />
                          Джедай
                        </label>
                        <button type="button" onClick={() => handleSaveCharacter(c.id)}>
                          Сохранить
                        </button>
                        <button type="button" onClick={() => setEditingCharId(null)}>
                          Отмена
                        </button>
                      </div>
                    </li>
                  ) : (
                    <li key={c.id}>
                      <span>
                        <strong>{c.regiment.name}</strong> — {c.service_id || "—"} {c.rank ? `${c.rank.code}` : ""}{" "}
                        {c.callsign || ""} {c.steam_id ? `· ${c.steam_id}` : ""}
                        {c.is_jedi && <span className="member-inactive-badge">джедай</span>}
                        {c.is_inactive && <span className="member-inactive-badge">неактивен</span>}
                      </span>
                      <span className="report-form-actions">
                        <button className="ghost" onClick={() => startEditCharacter(c)}>
                          Изменить
                        </button>
                        <button className="ghost" onClick={() => handleDeleteCharacter(c.id)}>
                          Удалить
                        </button>
                      </span>
                    </li>
                  )
                )}
              </ul>
            )}
            <div className="add-category-form">
              <select value={newCharRegimentId} onChange={(e) => setNewCharRegimentId(e.target.value)}>
                <option value="">— формирование —</option>
                {regiments.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
              <input
                type="text"
                placeholder="ИДН"
                value={newCharServiceId}
                onChange={(e) => setNewCharServiceId(e.target.value)}
                style={{ width: "6rem" }}
              />
              <input
                type="text"
                placeholder="Позывной"
                value={newCharCallsign}
                onChange={(e) => setNewCharCallsign(e.target.value)}
              />
              <select value={newCharRankId} onChange={(e) => setNewCharRankId(e.target.value)}>
                <option value="">— звание —</option>
                {tiers
                  .filter((tier) => (newCharIsJedi ? tier.is_jedi : !tier.is_jedi))
                  .flatMap((tier) =>
                    tier.ranks.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.code} — {r.name}
                      </option>
                    ))
                  )}
              </select>
              <input
                type="text"
                placeholder="Steam ID (необязательно)"
                value={newCharSteamId}
                onChange={(e) => setNewCharSteamId(e.target.value)}
              />
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={newCharIsJedi}
                  onChange={(e) => {
                    setNewCharIsJedi(e.target.checked);
                    setNewCharRankId("");
                  }}
                />
                Джедай
              </label>
              <button type="button" disabled={!newCharRegimentId} onClick={handleAddCharacter}>
                Добавить персонажа
              </button>
            </div>
          </div>

          <div className="regiment-panel fade-in-up">
            <h4>Выслуга (дней в текущем звании)</h4>
            <label>
              Дней
              <input type="number" min={0} value={daysInRank} onChange={(e) => setDaysInRank(e.target.value)} />
            </label>
            <button className="primary" onClick={handleSaveTenure}>
              Выставить выслугу
            </button>
          </div>

          <div className="regiment-panel fade-in-up">
            <h4>Выдать баллы</h4>
            <p className="hint-text">Начисляются в обход рапортов и засчитываются на повышение (можно и отрицательное число).</p>
            <label>
              Баллы
              <input
                type="number"
                value={adjustmentPoints}
                onChange={(e) => setAdjustmentPoints(e.target.value)}
              />
            </label>
            <label>
              Причина
              <input type="text" value={adjustmentReason} onChange={(e) => setAdjustmentReason(e.target.value)} />
            </label>
            <button className="primary" onClick={handleIssuePoints}>
              Начислить
            </button>
          </div>

          <div className="regiment-panel fade-in-up">
            <h4>Выдать выговор</h4>
            <label>
              Причина
              <input type="text" value={reprimandReason} onChange={(e) => setReprimandReason(e.target.value)} />
            </label>
            <label>
              Тип
              <select value={reprimandSeverity} onChange={(e) => setReprimandSeverity(e.target.value)}>
                <option value="strict">Строгий</option>
                <option value="verbal">Устный</option>
              </select>
            </label>
            <label>
              Баллов для снятия
              <input type="number" min={0} value={reprimandPoints} onChange={(e) => setReprimandPoints(e.target.value)} />
            </label>
            <button className="primary" onClick={handleIssueReprimand}>
              Выдать
            </button>
          </div>

          <div className="regiment-panel fade-in-up">
            <h4>Переопределить критерий повышения</h4>
            {requirements.length === 0 ? (
              <p className="hint-text">В этом формировании нет требований по категориям.</p>
            ) : (
              <>
                <label>
                  Требование
                  <select value={overrideRequirementId} onChange={(e) => setOverrideRequirementId(e.target.value)}>
                    <option value="">— выбрать —</option>
                    {requirements.map((req) => (
                      <option key={req.id} value={req.id}>
                        {categoriesById[req.category_id]?.name || `#${req.category_id}`} — нужно {req.count_required}{" "}
                        для звания {ranksById[req.rank_id]?.name || req.rank_id}
                        {req.is_mandatory ? " (обязательное)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Считать выполненным
                  <select value={overrideSatisfied ? "1" : "0"} onChange={(e) => setOverrideSatisfied(e.target.value === "1")}>
                    <option value="1">Да</option>
                    <option value="0">Нет</option>
                  </select>
                </label>
                <button className="primary" onClick={handleOverride}>
                  Применить оверрайд
                </button>
              </>
            )}
          </div>
        </>
      )}

      <div className="regiment-panel fade-in-up">
        <h4>Здоровье системы</h4>
        <div className="points-inline">
          <label className="points-inline-label">
            Заявки старше, дней
            <input
              type="number"
              min={1}
              value={healthStaleDays}
              onChange={(e) => {
                const value = Number(e.target.value) || 1;
                setHealthStaleDays(value);
                loadHealth(value);
              }}
              style={{ width: "4rem" }}
            />
          </label>
        </div>
        {systemHealth ? (
          <ul className="category-list">
            <li>
              Действующих бойцов
              <span className="category-points-badge">{systemHealth.active_users_count}</span>
            </li>
            <li>
              Зависших заявок на регистрацию
              <span className="category-points-badge">{systemHealth.stuck_registrations}</span>
            </li>
            <li>
              Зависших заявок на перевод
              <span className="category-points-badge">{systemHealth.stuck_transfers}</span>
            </li>
            <li>
              Зависших заявок на повышение
              <span className="category-points-badge">{systemHealth.stuck_promotions}</span>
            </li>
          </ul>
        ) : (
          <p className="hint-text">Загрузка...</p>
        )}
      </div>

      <div className="regiment-panel fade-in-up">
        <h4>Разжалованные {inactiveMembers.length > 0 && <span className="category-points-badge">{inactiveMembers.length}</span>}</h4>
        <p className="hint-text">
          Поперёк всех формирований разом — при разжаловании ИДН/звание/позывной обнуляются, поэтому опознать можно
          только по Discord-нику. Формирование определяется по текущей Discord-роли (она не снимается автоматически).
        </p>
        {inactiveMembers.length === 0 ? (
          <p className="hint-text">Разжалованных сейчас нет.</p>
        ) : (
          <ul className="member-report-list">
            {inactiveMembers.map((m) => (
              <li key={m.discord_id}>
                <span className="report-regiment">{m.username}</span>
                <span className="hint-text">
                  {" "}
                  {m.regiment_names.length > 0 ? m.regiment_names.join(", ") : "формирование не определено"}
                </span>
                <span className="member-report-date">
                  {m.last_login_at ? `последний вход: ${formatMskDate(m.last_login_at)} МСК` : "не входил"}
                </span>
                <div className="report-form-actions">
                  <button
                    type="button"
                    disabled={m.regiment_ids.length === 0 || reinstatingDiscordId === m.discord_id}
                    onClick={() => handleReinstate(m)}
                    title={m.regiment_ids.length === 0 ? "Не найден в составе ни одного формирования по Discord-роли" : undefined}
                  >
                    {reinstatingDiscordId === m.discord_id ? "Восстановление…" : "Восстановить в строй"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={`regiment-panel fade-in-up maintenance-panel ${maintenanceEnabled ? "maintenance-panel-active" : ""}`}>
        <div className="maintenance-panel-header">
          <h4>Режим обслуживания</h4>
          <span className={`status-pill ${maintenanceEnabled ? "status-pill-active" : "status-pill-idle"}`}>
            {maintenanceEnabled ? "Включён" : "Выключен"}
          </span>
        </div>
        <p className="hint-text">
          Включите на время миграций/восстановления из бэкапа — обычные пользователи увидят экран "Технические
          работы", вы сохраните доступ и увидите напоминание-баннер сверху.
        </p>
        <label className="toggle-switch">
          <input
            type="checkbox"
            checked={maintenanceEnabled}
            onChange={(e) => setMaintenanceEnabled(e.target.checked)}
          />
          <span className="toggle-switch-track">
            <span className="toggle-switch-thumb" />
          </span>
          <span className="toggle-switch-label">Включить режим обслуживания</span>
        </label>
        <label>
          Сообщение для пользователей (необязательно)
          <input
            type="text"
            placeholder="Например: обновление сервера, вернёмся через 15 минут"
            value={maintenanceMessage}
            onChange={(e) => setMaintenanceMessage(e.target.value)}
          />
        </label>
        <button className="primary" onClick={handleMaintenanceSave}>
          Сохранить
        </button>
      </div>

      <div className="regiment-panel fade-in-up">
        <h4>Каталог специализаций</h4>
        <p className="hint-text">
          Выдавать/снимать специализации бойцам может инструктор (роль настраивается в «Настройках») или
          администратор — прямо в личном деле бойца. Здесь редактируется только сам список доступных специализаций.
        </p>
        {SPECIALIZATION_CATEGORIES.map(({ value, label }) => {
          const items = specializations.filter((s) => s.category === value);
          if (items.length === 0) return null;
          return (
            <div key={value}>
              <p className="hint-text">{label}</p>
              <ul className="chip-list">
                {items.map((s) =>
                  editingSpecId === s.id ? (
                    <li key={s.id} className="chip chip-editing">
                      <input
                        type="text"
                        value={editSpecCode}
                        onChange={(e) => setEditSpecCode(e.target.value)}
                        style={{ width: "6rem" }}
                      />
                      <input type="text" value={editSpecName} onChange={(e) => setEditSpecName(e.target.value)} />
                      <select value={editSpecMinRankId} onChange={(e) => setEditSpecMinRankId(e.target.value)}>
                        <option value="">— мин. звание не задано —</option>
                        {tiers.flatMap((tier) =>
                          tier.ranks.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.code} — {r.name}
                            </option>
                          ))
                        )}
                      </select>
                      <select value={editSpecParentId} onChange={(e) => setEditSpecParentId(e.target.value)}>
                        <option value="">— без родительской —</option>
                        {specializations
                          .filter((p) => p.id !== s.id)
                          .map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.code} — {p.name}
                            </option>
                          ))}
                      </select>
                      <select
                        value={editSpecRequiredRegimentId}
                        onChange={(e) => setEditSpecRequiredRegimentId(e.target.value)}
                      >
                        <option value="">— любое формирование —</option>
                        {regiments.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                      <MultiSelectDropdown
                        items={specializations.filter((p) => p.id !== s.id).map((p) => ({ id: p.id, name: `${p.code} — ${p.name}` }))}
                        selectedIds={editSpecPrerequisiteIds}
                        onChange={setEditSpecPrerequisiteIds}
                        placeholder="Требуются все — выбрать"
                      />
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={editSpecIsSingleton}
                          onChange={(e) => setEditSpecIsSingleton(e.target.checked)}
                        />
                        Исключение (один боец на весь сервер)
                      </label>
                      <button type="button" onClick={() => handleSaveSpecialization(s.id)}>
                        Сохранить
                      </button>
                      <button type="button" onClick={cancelEditSpecialization}>
                        Отмена
                      </button>
                    </li>
                  ) : (
                    <li key={s.id} className="chip">
                      {s.code} — {s.name}
                      {s.min_rank && <span className="hint-text"> (от {s.min_rank.code})</span>}
                      {s.parent_id && (
                        <span className="hint-text">
                          {" "}
                          (после {specializations.find((p) => p.id === s.parent_id)?.code || "?"})
                        </span>
                      )}
                      {s.required_regiment_id && (
                        <span className="hint-text">
                          {" "}
                          [{regiments.find((r) => r.id === s.required_regiment_id)?.name || "?"}]
                        </span>
                      )}
                      {s.prerequisite_specialization_ids?.length > 0 && (
                        <span className="hint-text">
                          {" "}
                          (нужны все:{" "}
                          {s.prerequisite_specialization_ids
                            .map((id) => specializations.find((p) => p.id === id)?.code || "?")
                            .join(", ")}
                          )
                        </span>
                      )}
                      {s.is_singleton && <span className="tag-mandatory">исключение — 1 боец</span>}
                      <button type="button" title="Редактировать" onClick={() => startEditSpecialization(s)}>
                        ✎
                      </button>
                      <button type="button" onClick={() => handleDeleteSpecialization(s.id)}>
                        ×
                      </button>
                    </li>
                  )
                )}
              </ul>
            </div>
          );
        })}
        <div className="add-category-form">
          <input
            type="text"
            placeholder="Код (например, MED)"
            value={newSpecCode}
            onChange={(e) => setNewSpecCode(e.target.value)}
            style={{ width: "8rem" }}
          />
          <input
            type="text"
            placeholder="Название (например, Медик)"
            value={newSpecName}
            onChange={(e) => setNewSpecName(e.target.value)}
          />
          <select value={newSpecCategory} onChange={(e) => setNewSpecCategory(e.target.value)}>
            {SPECIALIZATION_CATEGORIES.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select value={newSpecMinRankId} onChange={(e) => setNewSpecMinRankId(e.target.value)}>
            <option value="">— мин. звание не задано —</option>
            {tiers.flatMap((tier) =>
              tier.ranks.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code} — {r.name}
                </option>
              ))
            )}
          </select>
          <select value={newSpecParentId} onChange={(e) => setNewSpecParentId(e.target.value)}>
            <option value="">— без родительской —</option>
            {specializations.map((p) => (
              <option key={p.id} value={p.id}>
                {p.code} — {p.name}
              </option>
            ))}
          </select>
          <select value={newSpecRequiredRegimentId} onChange={(e) => setNewSpecRequiredRegimentId(e.target.value)}>
            <option value="">— любое формирование —</option>
            {regiments.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <MultiSelectDropdown
            items={specializations.map((p) => ({ id: p.id, name: `${p.code} — ${p.name}` }))}
            selectedIds={newSpecPrerequisiteIds}
            onChange={setNewSpecPrerequisiteIds}
            placeholder="Требуются все — выбрать"
          />
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={newSpecIsSingleton}
              onChange={(e) => setNewSpecIsSingleton(e.target.checked)}
            />
            Исключение (один боец на весь сервер)
          </label>
          <button type="button" disabled={!newSpecCode.trim() || !newSpecName.trim()} onClick={handleAddSpecialization}>
            Добавить
          </button>
        </div>
      </div>

      <div className="regiment-panel fade-in-up">
        <h4>Журнал действий</h4>
        <p className="hint-text">
          Полный журнал (кто/что/когда, с фильтрами по действию, дате и типу) переехал на отдельную страницу.
        </p>
        <button type="button" className="primary" onClick={() => navigate("/logs")}>
          Открыть журнал
        </button>
      </div>
    </div>
  );
}
