import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { formatFullName } from "../utils/formatName";
import { InlineSpinner } from "./InlineSpinner";
import { MemberDetailModal } from "./MemberDetailModal";
import { commanderRoleLabel } from "../utils/regimentRoles";

/** Статичный список командования всех формирований — показывается справа на
 * странице Штаба вместо обычного состава (см. решение пользователя): высшее
 * командование сверху отдельным блоком, ниже формирования со своими
 * командиром/замами. Клик по имени открывает то же личное дело, что и в
 * обычном составе формирования (см. решение пользователя — было
 * принципиально некликабельно, но это оказалось неудобно) — HqPersonRead не
 * несёт всех полей GuildMemberRead, поэтому по клику полный профиль
 * подгружается через api.getMembers(regimentId) и ищется по discord_id. */
export function HqLeadershipPanel({ canManageMembers }) {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(null); // { member, regimentId } | null
  const [loadingDiscordId, setLoadingDiscordId] = useState(null);

  useEffect(() => {
    api
      .getHqLeadership(token)
      .then(setData)
      .catch(() => setData({ high_command: [], formations: [] }));
  }, [token]);

  // Высшее командование не привязано к одному формированию явно — если
  // человек оттуда также значится в одном из формирований ниже, берём его
  // regiment_id оттуда, иначе открывать личное дело не из чего (лишь discord_id)
  function findRegimentIdFor(discordId) {
    const formation = (data?.formations || []).find((f) =>
      f.commanders.some((c) => c.person.discord_id === discordId)
    );
    return formation?.regiment_id ?? null;
  }

  async function openMember(discordId, regimentId) {
    if (!regimentId || loadingDiscordId) return;
    setLoadingDiscordId(discordId);
    try {
      const members = await api.getMembers(token, regimentId);
      const member = members.find((m) => m.discord_id === discordId);
      if (member) setSelected({ member, regimentId });
    } catch {
      // тихо игнорируем — личное дело просто не откроется
    } finally {
      setLoadingDiscordId(null);
    }
  }

  if (!data) return <InlineSpinner />;

  return (
    <div className="hq-leadership-panel">
      <h3>Высшее командование</h3>
      {data.high_command.length === 0 ? (
        <p className="hint-text">Не назначено.</p>
      ) : (
        <ul className="hq-leadership-list">
          {data.high_command.map((p) => {
            const regimentId = findRegimentIdFor(p.discord_id);
            return (
              <li
                key={p.discord_id}
                className={regimentId ? "clickable-row" : undefined}
                onClick={regimentId ? () => openMember(p.discord_id, regimentId) : undefined}
              >
                {formatFullName(p)}
                {loadingDiscordId === p.discord_id && " …"}
              </li>
            );
          })}
        </ul>
      )}

      {data.formations.map((f) => (
        <div key={f.regiment_id} className="hq-formation-block">
          <h4 style={f.regiment_color ? { color: f.regiment_color } : undefined}>{f.regiment_name}</h4>
          {f.commanders.length === 0 ? (
            <p className="hint-text">Не назначено.</p>
          ) : (
            <ul className="hq-leadership-list">
              {f.commanders.map((c) => (
                <li
                  key={c.person.discord_id}
                  className="clickable-row"
                  onClick={() => openMember(c.person.discord_id, f.regiment_id)}
                >
                  {formatFullName(c.person)}{" "}
                  <span className="hint-text">({commanderRoleLabel(c.role_type, f.is_jedi_order)})</span>
                  {loadingDiscordId === c.person.discord_id && " …"}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}

      {selected && (
        <MemberDetailModal
          key={selected.member.discord_id}
          member={selected.member}
          regimentId={selected.regimentId}
          canEdit={Boolean(canManageMembers && canManageMembers(selected.regimentId))}
          onClose={() => setSelected(null)}
          onSaved={() => {
            api
              .getHqLeadership(token)
              .then(setData)
              .catch(() => {});
          }}
        />
      )}
    </div>
  );
}
