import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { SaveBar } from "../components/SaveBar";
import { useToast } from "../components/ToastContext";
import { formatMskDate } from "../utils/formatDate";
import { formatFullName } from "../utils/formatName";

/** Админ-панель ("God mode") — правки, недоступные обычному командиру/заместителю:
 * выговоры любому бойцу, ручная правка выслуги (дней в звании), смена ника/звания/ИДН,
 * ручное переопределение категорийных требований по повышению. Строго is_admin. */
function profileSnapshot(member) {
  return {
    serviceId: member?.service_id || "",
    callsign: member?.callsign || "",
    rankId: member?.rank?.id ?? "",
  };
}

export function AdminPanelPage() {
  const { token, regiments } = useAuth();
  const showToast = useToast();
  const [regimentId, setRegimentId] = useState(regiments[0]?.id ?? "");
  const [members, setMembers] = useState([]);
  const [discordId, setDiscordId] = useState("");
  const [tiers, setTiers] = useState([]);
  const [categories, setCategories] = useState([]);
  const [requirements, setRequirements] = useState([]);

  const ranksById = Object.fromEntries(tiers.flatMap((t) => t.ranks).map((r) => [r.id, r]));
  const categoriesById = Object.fromEntries(categories.map((c) => [c.id, c]));

  const [profileBaseline, setProfileBaseline] = useState(profileSnapshot(null));
  const [serviceId, setServiceId] = useState("");
  const [callsign, setCallsign] = useState("");
  const [rankId, setRankId] = useState("");
  const [daysInRank, setDaysInRank] = useState("");

  const [adjustmentPoints, setAdjustmentPoints] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");

  const [reprimandReason, setReprimandReason] = useState("");
  const [reprimandSeverity, setReprimandSeverity] = useState("strict");
  const [reprimandPoints, setReprimandPoints] = useState("");

  const [overrideRequirementId, setOverrideRequirementId] = useState("");
  const [overrideSatisfied, setOverrideSatisfied] = useState(true);

  const [auditLog, setAuditLog] = useState([]);
  const [showAuditLog, setShowAuditLog] = useState(false);

  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.getRanks(token).then(setTiers).catch(() => setTiers([]));
  }, [token]);

  useEffect(() => {
    if (!regimentId) return;
    api.getMembers(token, regimentId).then(setMembers).catch(() => setMembers([]));
    api.getCategoryRequirements(token, regimentId).then(setRequirements).catch(() => setRequirements([]));
    api.listCategories(token, regimentId).then(setCategories).catch(() => setCategories([]));
    setDiscordId("");
  }, [token, regimentId]);

  const member = members.find((m) => m.discord_id === discordId) || null;

  useEffect(() => {
    if (!member) return;
    const snapshot = profileSnapshot(member);
    setProfileBaseline(snapshot);
    setServiceId(snapshot.serviceId);
    setCallsign(snapshot.callsign);
    setRankId(snapshot.rankId);
    setDaysInRank(member.days_in_rank ?? "");
  }, [member]);

  const isProfileDirty =
    serviceId !== profileBaseline.serviceId ||
    callsign !== profileBaseline.callsign ||
    rankId !== profileBaseline.rankId;

  function handleResetProfile() {
    setServiceId(profileBaseline.serviceId);
    setCallsign(profileBaseline.callsign);
    setRankId(profileBaseline.rankId);
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
    await api.setMemberProfile(token, regimentId, discordId, {
      service_id: serviceId.trim() || null,
      callsign: callsign.trim() || null,
      rank_id: rankId === "" ? null : Number(rankId),
    });
    setProfileBaseline({ serviceId, callsign, rankId });
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

  function loadAuditLog() {
    api.listAuditLog(token).then(setAuditLog).catch((e) => setError(e.message));
    setShowAuditLog(true);
  }

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
              Звание
              <select value={rankId} onChange={(e) => setRankId(e.target.value)}>
                <option value="">— не назначено —</option>
                {tiers.map((tier) => (
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
            <SaveBar
              visible={isProfileDirty}
              saving={false}
              label="Есть несохранённые изменения в профиле"
              onSave={handleSaveProfile}
              onReset={handleResetProfile}
            />
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
        <h4>Журнал действий администрации</h4>
        {!showAuditLog ? (
          <button onClick={loadAuditLog}>Показать журнал</button>
        ) : auditLog.length === 0 ? (
          <p className="hint-text">Записей пока нет.</p>
        ) : (
          <ul className="member-report-list">
            {auditLog.map((entry) => (
              <li key={entry.id}>
                <span className="member-report-date">{formatMskDate(entry.created_at)} МСК</span>
                <p className="member-report-content">
                  <strong>{formatFullName(entry.actor)}</strong> — {entry.action}: {entry.details}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
