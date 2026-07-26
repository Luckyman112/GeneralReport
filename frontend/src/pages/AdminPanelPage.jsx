import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { SaveBar } from "../components/SaveBar";
import { useToast } from "../components/ToastContext";
import { downloadCsv } from "../utils/csv";
import { formatMskDate } from "../utils/formatDate";
import { formatFullName } from "../utils/formatName";

/** Админ-панель ("God mode") — правки, недоступные обычному командиру/заместителю:
 * выговоры любому бойцу, ручная правка выслуги (дней в звании), смена ника/звания/ИДН,
 * ручное переопределение категорийных требований по повышению. Строго is_admin. */
function profileSnapshot(member) {
  return {
    serviceId: member?.service_id || "",
    callsign: member?.callsign || "",
    steamId: member?.steam_id || "",
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
  const [steamId, setSteamId] = useState("");
  const [rankId, setRankId] = useState("");
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

  const [auditLog, setAuditLog] = useState([]);
  const [showAuditLog, setShowAuditLog] = useState(false);
  const [auditActionFilter, setAuditActionFilter] = useState("");
  const [auditDateFrom, setAuditDateFrom] = useState("");
  const [auditDateTo, setAuditDateTo] = useState("");

  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.getRanks(token).then(setTiers).catch(() => setTiers([]));
    api
      .getMaintenanceStatus()
      .then((s) => {
        setMaintenanceEnabled(s.enabled);
        setMaintenanceMessage(s.message || "");
      })
      .catch(() => {});
  }, [token]);

  async function handleMaintenanceSave() {
    try {
      await api.updateMaintenance(token, { enabled: maintenanceEnabled, message: maintenanceMessage.trim() || null });
      showToast("Режим обслуживания обновлён", "success");
    } catch (e) {
      setError(e.message);
    }
  }

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
    setSteamId(snapshot.steamId);
    setRankId(snapshot.rankId);
    setDaysInRank(member.days_in_rank ?? "");
  }, [member]);

  const isProfileDirty =
    serviceId !== profileBaseline.serviceId ||
    callsign !== profileBaseline.callsign ||
    steamId !== profileBaseline.steamId ||
    rankId !== profileBaseline.rankId;

  function handleResetProfile() {
    setServiceId(profileBaseline.serviceId);
    setCallsign(profileBaseline.callsign);
    setSteamId(profileBaseline.steamId);
    setRankId(profileBaseline.rankId);
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
    await api.setMemberProfile(token, regimentId, discordId, {
      service_id: serviceId.trim() || null,
      callsign: callsign.trim() || null,
      steam_id: steamId.trim() || null,
      rank_id: rankId === "" ? null : Number(rankId),
      ...(rankChanged ? { early_promotion_reason: earlyPromotionReason.trim() || null } : {}),
    });
    setProfileBaseline({ serviceId, callsign, steamId, rankId });
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

  function loadAuditLog() {
    api
      .listAuditLog(token, { action: auditActionFilter, dateFrom: auditDateFrom, dateTo: auditDateTo })
      .then(setAuditLog)
      .catch((e) => setError(e.message));
    setShowAuditLog(true);
  }

  function exportAuditLogCsv() {
    downloadCsv(
      "audit-log.csv",
      ["Дата", "Кто", "Действие", "Детали"],
      auditLog.map((entry) => [formatMskDate(entry.created_at), formatFullName(entry.actor), entry.action, entry.details])
    );
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
              Steam ID
              <input type="text" value={steamId} onChange={(e) => setSteamId(e.target.value)} />
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
            {rankId !== profileBaseline.rankId && (
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
        <h4>Режим обслуживания</h4>
        <p className="hint-text">
          Включите на время миграций/восстановления из бэкапа — обычные пользователи увидят экран "Технические
          работы", вы сохраните доступ и увидите напоминание-баннер сверху.
        </p>
        <label className="maintenance-toggle">
          <input
            type="checkbox"
            checked={maintenanceEnabled}
            onChange={(e) => setMaintenanceEnabled(e.target.checked)}
          />
          Включить режим обслуживания
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
        <h4>Журнал действий администрации</h4>

        {showAuditLog && (
          <div className="audit-log-filters">
            <label>
              Действие
              <input
                type="text"
                placeholder="например, reprimand"
                value={auditActionFilter}
                onChange={(e) => setAuditActionFilter(e.target.value)}
              />
            </label>
            <label>
              С даты
              <input type="date" value={auditDateFrom} onChange={(e) => setAuditDateFrom(e.target.value)} />
            </label>
            <label>
              По дату
              <input type="date" value={auditDateTo} onChange={(e) => setAuditDateTo(e.target.value)} />
            </label>
            <button onClick={loadAuditLog}>Применить</button>
            {auditLog.length > 0 && <button onClick={exportAuditLogCsv}>Скачать CSV</button>}
          </div>
        )}

        {!showAuditLog ? (
          <button onClick={loadAuditLog}>Показать журнал</button>
        ) : auditLog.length === 0 ? (
          <p className="hint-text">Записей нет.</p>
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
