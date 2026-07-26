import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { SaveBar } from "./SaveBar";
import { useToast } from "./ToastContext";
import { StatusBadge } from "./StatusBadge";
import { formatMskDate } from "../utils/formatDate";

function profileSnapshot(member) {
  return {
    serviceId: member.service_id ?? "",
    callsign: member.callsign ?? "",
    rankId: member.rank?.id ?? "",
    isInactive: member.is_inactive ?? false,
  };
}

export function MemberDetailModal({ member, regimentId, canEdit, onClose, onSaved }) {
  const { token } = useAuth();
  const showToast = useToast();
  const [baseline, setBaseline] = useState(() => profileSnapshot(member));
  const [serviceId, setServiceId] = useState(baseline.serviceId);
  const [callsign, setCallsign] = useState(baseline.callsign);
  const [rankId, setRankId] = useState(baseline.rankId);
  const [isInactive, setIsInactive] = useState(baseline.isInactive);
  const [tiers, setTiers] = useState([]);
  const [reports, setReports] = useState([]);
  const [reprimands, setReprimands] = useState([]);
  const [leaveRequests, setLeaveRequests] = useState([]);
  const [promotionStatus, setPromotionStatus] = useState(null);
  const [newReprimandReason, setNewReprimandReason] = useState("");
  const [newReprimandSeverity, setNewReprimandSeverity] = useState("strict");
  const [newReprimandPoints, setNewReprimandPoints] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [expandedRankKey, setExpandedRankKey] = useState(null);

  const totalPoints = reports.reduce((sum, r) => sum + (r.points ?? 0), 0);

  // Рапорты, свёрнутые по званию автора на момент подачи — клик по званию
  // открывает список рапортов, поданных в этом звании (не показываем все сразу)
  const reportsByRank = useMemo(() => {
    const groups = new Map();
    for (const r of reports) {
      const key = r.author_rank?.id ?? "none";
      if (!groups.has(key)) {
        groups.set(key, { key, rank: r.author_rank, reports: [] });
      }
      groups.get(key).reports.push(r);
    }
    return Array.from(groups.values());
  }, [reports]);
  const memberReprimands = reprimands.filter((r) => r.target.discord_id === member.discord_id);
  const hasActiveReprimand = memberReprimands.some((r) => !r.revoked_at && r.severity !== "verbal");
  const memberLeaveRequests = leaveRequests.filter((r) => r.user.discord_id === member.discord_id);

  const LEAVE_STATUS_LABELS = { pending: "ожидает решения", approved: "одобрена", rejected: "отклонена" };

  function loadReprimands() {
    api
      .listReprimands(token, regimentId)
      .then(setReprimands)
      .catch(() => setReprimands([]));
  }

  useEffect(() => {
    api
      .getMemberReports(token, regimentId, member.discord_id)
      .then(setReports)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    loadReprimands();
    api
      .listLeaveRequests(token)
      .then(setLeaveRequests)
      .catch(() => setLeaveRequests([]));
    api
      .getMemberPromotionStatus(token, regimentId, member.discord_id)
      .then(setPromotionStatus)
      .catch(() => setPromotionStatus(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, regimentId, member.discord_id]);

  useEffect(() => {
    api.getRanks(token).then(setTiers).catch(() => setTiers([]));
  }, [token]);

  async function handleIssueReprimand(e) {
    e.preventDefault();
    if (!newReprimandReason.trim()) return;
    setError(null);
    try {
      await api.issueReprimand(token, regimentId, {
        targetDiscordId: member.discord_id,
        reason: newReprimandReason.trim(),
        severity: newReprimandSeverity,
        pointsRequired: newReprimandPoints ? Number(newReprimandPoints) : 0,
      });
      setNewReprimandReason("");
      setNewReprimandPoints("");
      loadReprimands();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleRevokeReprimand(reprimandId) {
    try {
      await api.revokeReprimand(token, regimentId, reprimandId);
      loadReprimands();
    } catch (e) {
      setError(e.message);
    }
  }

  const isDirty =
    serviceId !== baseline.serviceId ||
    callsign !== baseline.callsign ||
    rankId !== baseline.rankId ||
    isInactive !== baseline.isInactive;

  function handleResetProfile() {
    setServiceId(baseline.serviceId);
    setCallsign(baseline.callsign);
    setRankId(baseline.rankId);
    setIsInactive(baseline.isInactive);
  }

  async function handleSaveProfile() {
    setSaving(true);
    setError(null);
    try {
      await api.setMemberProfile(token, regimentId, member.discord_id, {
        service_id: serviceId.trim() || null,
        callsign: callsign.trim() || null,
        rank_id: rankId === "" ? null : Number(rankId),
        is_inactive: isInactive,
      });
      setBaseline({ serviceId, callsign, rankId, isInactive });
      showToast("Профиль сохранён");
      onSaved();
    } catch (e) {
      setError(e.message);
      showToast(e.message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{member.username}</h3>
        <p className="hint-text">Discord: {member.discord_username}</p>

        {canEdit ? (
          <div className="member-profile-form">
            <label>
              ИДН (4 цифры)
              <input
                type="text"
                maxLength={4}
                value={serviceId}
                onChange={(e) => setServiceId(e.target.value)}
                placeholder="0000"
              />
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
            <label>
              Позывной (он же веб-ник — используется везде, включая рапорты)
              <input type="text" value={callsign} onChange={(e) => setCallsign(e.target.value)} />
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={isInactive} onChange={(e) => setIsInactive(e.target.checked)} />
              Неактивен (не может писать рапорта)
            </label>
            <SaveBar
              visible={isDirty}
              saving={saving}
              label="Есть несохранённые изменения в профиле"
              onSave={handleSaveProfile}
              onReset={handleResetProfile}
            />
          </div>
        ) : (
          member.rank && (
            <p className="hint-text">
              {member.rank.code} — {member.rank.name}
              {member.callsign && ` · ${member.callsign}`}
            </p>
          )
        )}
        {error && <p className="error-text">{error}</p>}

        {promotionStatus?.next_rank && (
          <div className="regiment-panel fade-in-up">
            <h4>Осталось до повышения</h4>
            <p className="hint-text">
              {promotionStatus.current_rank?.code} → <strong>{promotionStatus.next_rank.code}</strong> —{" "}
              {promotionStatus.next_rank.name}
            </p>
            <p className="hint-text">
              Баллы: {promotionStatus.points_current} / {promotionStatus.points_required}
              {promotionStatus.days_required != null &&
                ` · Дней в звании: ${promotionStatus.days_in_rank ?? 0} / ${promotionStatus.days_required}`}
            </p>
            {promotionStatus.category_requirements?.length > 0 && (
              <ul className="requirement-checklist">
                {promotionStatus.category_requirements.map((req) => (
                  <li
                    key={req.requirement_id}
                    className={req.satisfied ? "requirement-item requirement-item-done" : "requirement-item"}
                  >
                    <span className="requirement-check">{req.satisfied && "✓"}</span>
                    <span className="requirement-label">
                      {req.category_name} ({req.count_current} / {req.count_required})
                      {req.is_mandatory && <span className="tag-mandatory">обязательное</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {promotionStatus.has_active_reprimand && (
              <p className="error-text">Есть непогашенный строгий выговор — повышение недоступно.</p>
            )}
          </div>
        )}

        <h4>
          Выговоры {hasActiveReprimand && <span className="member-inactive-badge">есть непогашенный (строгий)</span>}
        </h4>
        {memberReprimands.length === 0 ? (
          <p className="hint-text">Выговоров нет.</p>
        ) : (
          <ul className="member-report-list">
            {memberReprimands.map((r) => (
              <li key={r.id}>
                <span className={r.revoked_at ? "hint-text" : "error-text"}>
                  {r.revoked_at ? "снят" : "действует"}
                </span>{" "}
                <span className="hint-text">{r.severity === "verbal" ? "устный" : "строгий"}</span>
                {r.auto_escalated && <span className="hint-text"> (авто-эскалация)</span>}
                <span className="member-report-date">{formatMskDate(r.issued_at)} МСК</span>
                <p className="member-report-content">{r.reason}</p>
                {r.points_required > 0 && (
                  <p className="hint-text">
                    Для снятия нужно баллов: {r.points_required} (набрано: {r.points_earned})
                  </p>
                )}
                {canEdit && !r.revoked_at && (
                  <button className="ghost" onClick={() => handleRevokeReprimand(r.id)}>
                    Снять
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <form onSubmit={handleIssueReprimand} className="add-category-form">
            <input
              type="text"
              placeholder="Причина выговора"
              value={newReprimandReason}
              onChange={(e) => setNewReprimandReason(e.target.value)}
            />
            <select value={newReprimandSeverity} onChange={(e) => setNewReprimandSeverity(e.target.value)}>
              <option value="strict">Строгий</option>
              <option value="verbal">Устный</option>
            </select>
            <input
              type="number"
              min={0}
              placeholder="Баллов для снятия"
              value={newReprimandPoints}
              onChange={(e) => setNewReprimandPoints(e.target.value)}
              style={{ width: "9rem" }}
            />
            <button type="submit">Выдать выговор</button>
          </form>
        )}

        <h4>Отпуска</h4>
        {memberLeaveRequests.length === 0 ? (
          <p className="hint-text">Заявок на отпуск нет.</p>
        ) : (
          <ul className="member-report-list">
            {memberLeaveRequests.map((r) => (
              <li key={r.id}>
                <span className="hint-text">{LEAVE_STATUS_LABELS[r.status]}</span>
                <span className="member-report-date">
                  {r.start_date} — {r.end_date}
                </span>
                <p className="member-report-content">{r.reason}</p>
              </li>
            ))}
          </ul>
        )}

        <h4>Рапорты {!loading && reports.length > 0 && <span className="category-points-badge">— всего баллов: {totalPoints}</span>}</h4>
        {loading ? (
          <p>Загрузка...</p>
        ) : reports.length === 0 ? (
          <p className="hint-text">Рапортов нет.</p>
        ) : (
          <ul className="rank-accordion">
            {reportsByRank.map((group) => {
              const isOpen = expandedRankKey === group.key;
              const groupPoints = group.reports.reduce((sum, r) => sum + (r.points ?? 0), 0);
              return (
                <li key={group.key} className="rank-accordion-group">
                  <button
                    type="button"
                    className="rank-accordion-header"
                    onClick={() => setExpandedRankKey(isOpen ? null : group.key)}
                  >
                    <span className={`rank-accordion-arrow ${isOpen ? "rank-accordion-arrow-open" : ""}`}>▸</span>
                    <span>{group.rank ? `${group.rank.code} — ${group.rank.name}` : "Без звания"}</span>
                    <span className="hint-text">
                      {group.reports.length} · {groupPoints} баллов
                    </span>
                  </button>
                  {isOpen && (
                    <ul className="member-report-list">
                      {group.reports.map((r) => (
                        <li key={r.id}>
                          <StatusBadge status={r.status} />
                          {r.points !== null && <span className="category-points-badge"> Баллы: {r.points}</span>}
                          <span className="member-report-date">{formatMskDate(r.created_at)} МСК</span>
                          <p className="member-report-content">{r.content}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
