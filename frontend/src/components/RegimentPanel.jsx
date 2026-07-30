import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useLiveEvents } from "../hooks/useLiveEvents";
import { formatFullName } from "../utils/formatName";
import { InlineSpinner } from "./InlineSpinner";
import { LinkIcon } from "./icons";
import { MemberDetailModal } from "./MemberDetailModal";
import { PromotionReviewModal } from "./PromotionReviewModal";

const NO_RANK_GROUP = "Без звания";
// SSE (см. useLiveEvents) обновляет мгновенно — поллинг оставлен редким запасным
// вариантом на случай обрыва соединения
const PENDING_POLL_INTERVAL_MS = 60000;

/** Состав формирования (ростер) — клик по участнику открывает его карточку.
 * Участники группируются по составу (звания), от высших к низшим, как в
 * общевойсковой таблице званий. */
export function RegimentPanel({ regiments, canManageMembers, initialRegimentId, focusDiscordId }) {
  const { token } = useAuth();
  const [regimentId, setRegimentId] = useState(initialRegimentId ?? regiments[0]?.id ?? "");
  const [members, setMembers] = useState([]);
  const [tiers, setTiers] = useState([]);
  const [selectedMember, setSelectedMember] = useState(null);
  const focusedDiscordIdRef = useRef(focusDiscordId ?? null);

  // Переход из глобального поиска — переключаемся на нужное формирование и,
  // как только состав подгрузится, откроем карточку конкретного бойца
  useEffect(() => {
    if (initialRegimentId) setRegimentId(initialRegimentId);
    focusedDiscordIdRef.current = focusDiscordId ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRegimentId, focusDiscordId]);
  const [reviewRequestId, setReviewRequestId] = useState(null);
  const [pendingRequestByDiscordId, setPendingRequestByDiscordId] = useState({});
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
      if (requestIdRef.current === requestId) {
        setMembers(data);
        if (focusedDiscordIdRef.current) {
          const target = data.find((m) => m.discord_id === focusedDiscordIdRef.current);
          if (target) setSelectedMember(target);
          focusedDiscordIdRef.current = null;
        }
      }
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

  const loadPending = useCallback(() => {
    if (!regimentId || !canEditHere) {
      setPendingRequestByDiscordId({});
      return;
    }
    api
      .listPromotionRequests(token)
      .then((requests) => {
        const byDiscordId = Object.fromEntries(
          requests.filter((r) => r.regiment_id === Number(regimentId)).map((r) => [r.user.discord_id, r.id])
        );
        setPendingRequestByDiscordId(byDiscordId);
      })
      .catch(() => setPendingRequestByDiscordId({}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, regimentId, canEditHere]);

  useLiveEvents("promotions", loadPending);

  useEffect(() => {
    if (!regimentId || !canEditHere) {
      setPendingRequestByDiscordId({});
      return undefined;
    }
    loadPending();
    // Кнопка "Доступно повышение" не должна висеть после того, как заявку уже
    // решили на другой странице (например, "Повышения") — SSE обновляет мгновенно,
    // это лишь редкий запасной поллинг на случай обрыва соединения
    const interval = setInterval(loadPending, PENDING_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [token, regimentId, canEditHere]);

  useEffect(() => {
    api.getRanks(token).then(setTiers).catch(() => setTiers([]));
  }, [token]);

  const [showInactive, setShowInactive] = useState(false);
  const inactiveCount = members.filter((m) => m.is_inactive).length;
  const visibleMembers = showInactive ? members : members.filter((m) => !m.is_inactive);

  const groups = useMemo(() => {
    const byTier = new Map();
    for (const m of visibleMembers) {
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
  }, [visibleMembers, tiers]);

  return (
    <div className="regiment-panel">
      <div className="regiment-panel-toolbar">
        {regiments.length > 1 && (
          <label>
            Состав какого формирования показать
            <select value={regimentId} onChange={(e) => setRegimentId(e.target.value)}>
              {regiments.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {error && <p className="error-text">{error}</p>}
      {loading ? (
        <InlineSpinner />
      ) : (
        <>
          <div className="reports-toolbar">
            <h4 style={{ margin: 0 }}>Состав ({visibleMembers.length})</h4>
            {canEditHere && inactiveCount > 0 && (
              <button className="ghost" onClick={() => setShowInactive((v) => !v)}>
                {showInactive ? "Скрыть разжалованных" : `Показать разжалованных (${inactiveCount})`}
              </button>
            )}
          </div>
          {groups.map((group) => (
            <div key={group.title} className="member-list-group fade-in-up">
              <p className="member-list-group-title">{group.title}</p>
              <div className="roster-table-wrap">
                <table className="roster-table">
                  <thead>
                    <tr>
                      <th></th>
                      <th>Участник</th>
                      <th>Дней в звании</th>
                      {canEditHere && <th></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {group.members.map((m) => (
                      <tr key={m.discord_id} onClick={() => setSelectedMember(m)}>
                        <td>
                          <span className={`status-dot ${m.is_inactive ? "status-dot-muted" : "status-dot-accent"}`} />
                        </td>
                        <td>
                          <span className="roster-member-cell">
                            {(m.photo_url || m.avatar_url) && (
                              <img src={m.photo_url || m.avatar_url} alt="" className="member-avatar" />
                            )}
                            <span style={regimentColor ? { color: regimentColor } : undefined}>
                              {formatFullName(m)}
                            </span>
                            {m.is_inactive && <span className="member-inactive-badge">разжалован</span>}
                          </span>
                        </td>
                        <td className="mono-num">{m.days_in_rank ?? "—"}</td>
                        {canEditHere && (
                          <td>
                            {pendingRequestByDiscordId[m.discord_id] != null && (
                              <button
                                className="primary"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setReviewRequestId(pendingRequestByDiscordId[m.discord_id]);
                                }}
                              >
                                Доступно повышение
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          {currentRegiment?.discord_channel_url && (
            <a
              href={currentRegiment.discord_channel_url}
              target="_blank"
              rel="noreferrer"
              className="regiment-info-channel-link"
              style={{ marginTop: "0.5rem" }}
            >
              <LinkIcon /> Канал формирования
            </a>
          )}
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

      {reviewRequestId && (
        <PromotionReviewModal requestId={reviewRequestId} onClose={() => setReviewRequestId(null)} />
      )}
    </div>
  );
}
