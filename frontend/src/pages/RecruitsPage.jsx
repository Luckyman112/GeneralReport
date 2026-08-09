import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { EmptyState } from "../components/EmptyState";
import { PageLoading } from "../components/PageLoading";
import { steamProfileUrl } from "../utils/steam";
import { discordProfileUrl } from "../utils/discord";

/** Рекрутская — состав 17-го Передового Полка, доступен командиру/заму ЛЮБОГО
 * формирования (не только 17-го), см. app/api/regiments.py::get_members —
 * иначе, кто вправе решать по повышению рекрута (см. can_decide_promotion),
 * не смог бы его даже найти. Только просмотр/поиск — подать рапорт «Курс
 * молодого бойца» и решить по дальнейшим повышениям делают на обычных
 * страницах Рапорты/Повышения. */
export function RecruitsPage() {
  const { token, access } = useAuth();
  const [members, setMembers] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!access?.recruit_regiment_id) {
      setLoading(false);
      return;
    }
    api
      .getMembers(token, access.recruit_regiment_id)
      .then(setMembers)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token, access?.recruit_regiment_id]);

  const visibleMembers = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return members;
    return members.filter((m) =>
      [m.callsign, m.discord_username, m.username, m.service_id].some((v) => v?.toLowerCase().includes(query))
    );
  }, [members, search]);

  if (loading) return <PageLoading />;

  return (
    <div className="page-container">
      <h2>Рекрутская</h2>
      <p className="hint-text">
        Состав 17-го Передового Полка — рапорт «Курс молодого бойца» подаётся на странице «Рапорты»,
        дальнейшие повышения решаются на странице «Повышения».
      </p>

      {!access?.recruit_regiment_id ? (
        <EmptyState text="17-й Передовой Полк не настроен." />
      ) : (
        <>
          <label className="violation-filter-label">
            Поиск (позывной / ник / ИДН)
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Например: Demiyrg" />
          </label>

          {error && <p className="error-text">{error}</p>}

          {visibleMembers.length === 0 ? (
            <EmptyState text="Никого не найдено." />
          ) : (
            <div className="roster-table-wrap">
              <table className="roster-table">
                <thead>
                  <tr>
                    <th>ИДН</th>
                    <th>Звание</th>
                    <th>Позывной</th>
                    <th>STEAM:ID</th>
                    <th>Discord ID</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleMembers.map((m) => (
                    <tr key={m.discord_id}>
                      <td className="mono-num">{m.service_id || "—"}</td>
                      <td>{m.rank ? `${m.rank.code} — ${m.rank.name}` : "—"}</td>
                      <td>{m.callsign || m.username}</td>
                      <td className="mono-num">
                        {m.steam_id ? (
                          steamProfileUrl(m.steam_id) ? (
                            <a href={steamProfileUrl(m.steam_id)} target="_blank" rel="noreferrer">
                              {m.steam_id}
                            </a>
                          ) : (
                            m.steam_id
                          )
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="mono-num">
                        <a href={discordProfileUrl(m.discord_id)} target="_blank" rel="noreferrer">
                          {m.discord_id}
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
