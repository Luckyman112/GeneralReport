import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { MemberDetailModal } from "./MemberDetailModal";

const NO_RANK_GROUP = "Без звания";

/** Состав формирования (ростер) — клик по участнику открывает его карточку.
 * Участники группируются по составу (звания), от высших к низшим, как в
 * общевойсковой таблице званий. */
export function RegimentPanel({ regiments, canManageMembers }) {
  const { token } = useAuth();
  const [regimentId, setRegimentId] = useState(regiments[0]?.id ?? "");
  const [members, setMembers] = useState([]);
  const [tiers, setTiers] = useState([]);
  const [selectedMember, setSelectedMember] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  // Защита от гонки: если формирование переключили, пока летел старый запрос,
  // его устаревший ответ не должен затереть уже актуальные данные
  const requestIdRef = useRef(0);

  const canEditHere = canManageMembers(Number(regimentId));
  const currentRegiment = regiments.find((r) => r.id === Number(regimentId));
  const regimentColor = currentRegiment?.color || null;

  async function loadMembers(id) {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const data = await api.getMembers(token, id);
      if (requestIdRef.current === requestId) setMembers(data);
    } catch (e) {
      if (requestIdRef.current === requestId) setError(e.message);
    } finally {
      if (requestIdRef.current === requestId) setLoading(false);
    }
  }

  useEffect(() => {
    if (regimentId) loadMembers(regimentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, regimentId]);

  useEffect(() => {
    api.getRanks(token).then(setTiers).catch(() => setTiers([]));
  }, [token]);

  const groups = useMemo(() => {
    const byTier = new Map();
    for (const m of members) {
      const key = m.rank?.tier_id ?? NO_RANK_GROUP;
      if (!byTier.has(key)) byTier.set(key, []);
      byTier.get(key).push(m);
    }
    for (const list of byTier.values()) {
      list.sort((a, b) => (b.rank?.order ?? 0) - (a.rank?.order ?? 0));
    }

    // От высших составов к низшим — сначала самый старший состав
    const ordered = [...tiers]
      .sort((a, b) => b.order - a.order)
      .filter((t) => byTier.has(t.id))
      .map((t) => ({ title: t.name, members: byTier.get(t.id) }));

    if (byTier.has(NO_RANK_GROUP)) {
      ordered.push({ title: NO_RANK_GROUP, members: byTier.get(NO_RANK_GROUP) });
    }
    return ordered;
  }, [members, tiers]);

  return (
    <div className="regiment-panel">
      {regiments.length > 1 && (
        <label>
          Формирование
          <select value={regimentId} onChange={(e) => setRegimentId(e.target.value)}>
            {regiments.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {error && <p className="error-text">{error}</p>}
      {loading ? (
        <p>Загрузка...</p>
      ) : (
        <>
          <h4>Состав ({members.length})</h4>
          {groups.map((group) => (
            <div key={group.title} className="member-list-group fade-in-up">
              <p className="member-list-group-title">{group.title}</p>
              <ul className="member-list">
                {group.members.map((m) => (
                  <li key={m.discord_id}>
                    <button
                      className={`member-button${m.is_inactive ? " member-inactive" : ""}`}
                      onClick={() => setSelectedMember(m)}
                    >
                      {m.avatar_url && <img src={m.avatar_url} alt="" className="member-avatar" />}
                      <span style={regimentColor ? { color: regimentColor } : undefined}>{m.username}</span>
                      {m.is_inactive && <span className="member-inactive-badge">неактивен</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      )}

      {selectedMember && (
        <MemberDetailModal
          member={selectedMember}
          regimentId={Number(regimentId)}
          canEdit={canEditHere}
          onClose={() => setSelectedMember(null)}
          onSaved={() => {
            loadMembers(regimentId);
          }}
        />
      )}
    </div>
  );
}
