import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { InlineSpinner } from "./InlineSpinner";
import { LinkIcon } from "./icons";
import { MemberDetailModal } from "./MemberDetailModal";
import { formatMskDate } from "../utils/formatDate";

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

/** Универсальная таблица состава — доступна всем: выбрать формирование кнопкой,
 * дальше открывается табличка с полным составом (пример — экспортированная из
 * Excel таблица командования). Заменяет собой старую (неверную) таблицу состава,
 * которая раньше открывалась кнопкой "Инфо" на панели формирования. */
export function RosterBrowserModal({ onClose }) {
  const { token, access, regiments } = useAuth();
  const [regimentId, setRegimentId] = useState(null);
  const [members, setMembers] = useState([]);
  const [commanders, setCommanders] = useState([]);
  const [reprimands, setReprimands] = useState([]);
  const [activeLeaveDiscordIds, setActiveLeaveDiscordIds] = useState(new Set());
  const [specializationsByDiscordId, setSpecializationsByDiscordId] = useState({});
  const [loading, setLoading] = useState(false);
  const [selectedMember, setSelectedMember] = useState(null);

  const regiment = regiments.find((r) => r.id === regimentId);
  const canEditHere = Boolean(
    access?.is_admin || access?.is_high_command || (access?.commander_regiment_ids || []).includes(regimentId)
  );

  useEffect(() => {
    if (!regimentId) return;
    setLoading(true);
    setSelectedMember(null);

    async function load() {
      const [membersData, commandersData] = await Promise.all([
        api.getMembers(token, regimentId),
        api.listCommanders(token, regimentId),
      ]);
      setMembers(membersData);
      setCommanders(commandersData);

      const [reprimandsResult, leaveResult, specResults] = await Promise.allSettled([
        api.listReprimands(token, regimentId),
        api.listLeaveRequests(token),
        Promise.all(
          membersData.map((m) =>
            api
              .listMemberSpecializations(token, m.discord_id)
              .then((specs) => [m.discord_id, specs])
              .catch(() => [m.discord_id, []])
          )
        ),
      ]);

      setReprimands(reprimandsResult.status === "fulfilled" ? reprimandsResult.value : []);

      const today = todayIsoDate();
      const activeIds = new Set();
      if (leaveResult.status === "fulfilled") {
        for (const lr of leaveResult.value) {
          if (lr.regiment_id === regimentId && lr.status === "approved" && lr.start_date <= today && lr.end_date >= today) {
            activeIds.add(lr.user?.discord_id);
          }
        }
      }
      setActiveLeaveDiscordIds(activeIds);

      if (specResults.status === "fulfilled") {
        setSpecializationsByDiscordId(Object.fromEntries(specResults.value));
      }
    }

    load().finally(() => setLoading(false));
  }, [token, regimentId]);

  const positionByDiscordId = useMemo(() => {
    const map = new Map();
    for (const c of commanders) {
      const label = c.role_type === "mentor" ? "Наставник" : c.role_type === "deputy" ? "Заместитель" : "Командир";
      map.set(c.discord_id, label);
    }
    return map;
  }, [commanders]);

  const activeReprimandCountByDiscordId = useMemo(() => {
    const map = new Map();
    for (const r of reprimands) {
      if (r.revoked_at) continue;
      const id = r.target?.discord_id;
      if (!id) continue;
      map.set(id, (map.get(id) || 0) + 1);
    }
    return map;
  }, [reprimands]);

  // Только реально зарегистрированные (ИДН/звание задано) — незарегистрированные
  // тут только мусорят таблицу; командир формирования сверху, ниже по убыванию
  // звания (см. решение пользователя)
  const sortedMembers = useMemo(() => {
    const registered = members.filter((m) => m.registration_status === "approved");
    return [...registered].sort((a, b) => {
      const aIsCommander = positionByDiscordId.get(a.discord_id) === "Командир";
      const bIsCommander = positionByDiscordId.get(b.discord_id) === "Командир";
      if (aIsCommander !== bIsCommander) return aIsCommander ? -1 : 1;
      return (b.rank?.order ?? -1) - (a.rank?.order ?? -1);
    });
  }, [members, positionByDiscordId]);

  const modalContent = (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal roster-browser-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" aria-label="Закрыть" onClick={onClose}>
          ×
        </button>
        {!regimentId ? (
          <>
            <h3>Состав — выбор формирования</h3>
            <div className="field-tags">
              {regiments.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="ghost"
                  style={r.color ? { color: r.color, borderColor: r.color } : undefined}
                  onClick={() => setRegimentId(r.id)}
                >
                  {r.name}
                </button>
              ))}
            </div>
            <div className="modal-actions">
              <button className="ghost" onClick={onClose}>
                Закрыть
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 style={regiment?.color ? { color: regiment.color } : undefined}>{regiment?.name} — состав</h3>
            {regiment?.discord_channel_url && (
              <a
                href={regiment.discord_channel_url}
                target="_blank"
                rel="noreferrer"
                className="regiment-info-channel-link"
              >
                <LinkIcon /> Канал формирования
              </a>
            )}
            {loading ? (
              <InlineSpinner />
            ) : (
              <div className="roster-table-wrap roster-table-wrap-full">
                <table className="roster-table roster-table-full">
                  <thead>
                    <tr>
                      <th>ИДН</th>
                      <th>Звание</th>
                      <th>Позывной</th>
                      <th>Дата вступления</th>
                      <th>Дата повышения</th>
                      <th>Должность</th>
                      <th>Специализации</th>
                      <th>STEAM:ID</th>
                      <th>Discord ID</th>
                      <th>Выговоры</th>
                      <th>Отпуск</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedMembers.map((m) => (
                      <tr key={m.discord_id} onClick={() => setSelectedMember(m)} className="clickable-row">
                        <td className="mono-num">{m.service_id || "—"}</td>
                        <td>{m.rank ? `${m.rank.code} — ${m.rank.name}` : "—"}</td>
                        <td>{m.callsign || m.username}</td>
                        <td>{m.joined_at ? formatMskDate(m.joined_at) : "—"}</td>
                        <td>{m.rank_assigned_at ? formatMskDate(m.rank_assigned_at) : "—"}</td>
                        <td>{positionByDiscordId.get(m.discord_id) || "Рядовой"}</td>
                        <td>
                          {(specializationsByDiscordId[m.discord_id] || [])
                            .map((s) => s.specialization?.code)
                            .filter(Boolean)
                            .join(", ") || "—"}
                        </td>
                        <td>{m.steam_id || "—"}</td>
                        <td className="mono-num">{m.discord_id}</td>
                        <td className="mono-num">{activeReprimandCountByDiscordId.get(m.discord_id) || 0}</td>
                        <td>{activeLeaveDiscordIds.has(m.discord_id) ? "В отпуске" : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="modal-actions">
              <button className="ghost" onClick={() => setRegimentId(null)}>
                Назад к списку формирований
              </button>
              <button className="ghost" onClick={onClose}>
                Закрыть
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );

  return (
    <>
      {createPortal(modalContent, document.body)}
      {selectedMember && (
        <MemberDetailModal
          key={selectedMember.discord_id}
          member={selectedMember}
          regimentId={regimentId}
          canEdit={canEditHere}
          onClose={() => setSelectedMember(null)}
          onSaved={() => {
            api.getMembers(token, regimentId).then(setMembers);
          }}
        />
      )}
    </>
  );
}
