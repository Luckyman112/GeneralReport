import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { StatusBadge } from "./StatusBadge";
import { formatMskDate } from "../utils/formatDate";

export function MemberDetailModal({ member, regimentId, canEdit, onClose, onSaved }) {
  const { token } = useAuth();
  const [nickname, setNickname] = useState(member.username);
  const [serviceId, setServiceId] = useState(member.service_id ?? "");
  const [callsign, setCallsign] = useState(member.callsign ?? "");
  const [rankId, setRankId] = useState(member.rank?.id ?? "");
  const [isInactive, setIsInactive] = useState(member.is_inactive ?? false);
  const [tiers, setTiers] = useState([]);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const totalPoints = reports.reduce((sum, r) => sum + (r.points ?? 0), 0);

  useEffect(() => {
    api
      .getMemberReports(token, regimentId, member.discord_id)
      .then(setReports)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token, regimentId, member.discord_id]);

  useEffect(() => {
    api.getRanks(token).then(setTiers).catch(() => setTiers([]));
  }, [token]);

  const currentTier = tiers.find((t) => t.id === member.rank?.tier_id);
  const nextTier = currentTier ? tiers.find((t) => t.order === currentTier.order + 1) : null;

  async function handleSaveProfile(e) {
    e.preventDefault();
    if (!nickname.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api.setMemberProfile(token, regimentId, member.discord_id, {
        nickname: nickname.trim(),
        service_id: serviceId.trim() || null,
        callsign: callsign.trim() || null,
        rank_id: rankId === "" ? null : Number(rankId),
        is_inactive: isInactive,
      });
      onSaved();
    } catch (e) {
      setError(e.message);
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
          <form onSubmit={handleSaveProfile} className="member-profile-form">
            <label>
              Веб-ник
              <input type="text" value={nickname} onChange={(e) => setNickname(e.target.value)} />
            </label>
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
              Позывной
              <input type="text" value={callsign} onChange={(e) => setCallsign(e.target.value)} />
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={isInactive} onChange={(e) => setIsInactive(e.target.checked)} />
              Неактивен (не может писать рапорта)
            </label>
            <button type="submit" disabled={saving} className="primary">
              Сохранить профиль
            </button>
          </form>
        ) : (
          member.rank && (
            <p className="hint-text">
              {member.rank.code} — {member.rank.name}
              {member.callsign && ` · ${member.callsign}`}
            </p>
          )
        )}
        {member.rank && member.days_in_rank !== null && (
          <p className="hint-text">
            Дней в текущем звании: {member.days_in_rank}
            {nextTier?.tenure_days_required != null &&
              ` (для перехода в «${nextTier.name}» требуется ${nextTier.tenure_days_required} дн.)`}
          </p>
        )}

        {error && <p className="error-text">{error}</p>}

        <h4>Рапорты {!loading && reports.length > 0 && <span className="category-points-badge">— всего баллов: {totalPoints}</span>}</h4>
        {loading ? (
          <p>Загрузка...</p>
        ) : reports.length === 0 ? (
          <p className="hint-text">Рапортов нет.</p>
        ) : (
          <ul className="member-report-list">
            {reports.map((r) => (
              <li key={r.id}>
                <StatusBadge status={r.status} />
                {r.points !== null && <span className="category-points-badge"> Баллы: {r.points}</span>}
                <span className="member-report-date">{formatMskDate(r.created_at)} МСК</span>
                <p className="member-report-content">{r.content}</p>
              </li>
            ))}
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
