import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { EmptyState } from "../components/EmptyState";
import { PageLoading } from "../components/PageLoading";
import { StatusBadge } from "../components/StatusBadge";
import { formatMskDate } from "../utils/formatDate";
import { formatFullNameAtRank } from "../utils/formatName";
import { steamProfileUrl } from "../utils/steam";
import { discordProfileUrl } from "../utils/discord";

/** Рекрутская — состав 17-го Передового Полка (виден только командиру/заму ЛЮБОГО
 * формирования, см. app/api/regiments.py::get_members — иначе, кто вправе решать
 * по повышению рекрута, не смог бы его даже найти) + список всех рапортов «Курс
 * молодого бойца» разом (виден ЛЮБОМУ бойцу — см. решение пользователя: интересно
 * видеть, как обучают рекрутов, независимо от формирования). Подать рапорт «Курс
 * молодого бойца» и решить по дальнейшим повышениям делают на обычных страницах
 * Рапорты/Повышения — здесь только просмотр. */
export function RecruitsPage() {
  const { token, access } = useAuth();
  const canViewRoster = Boolean(
    access?.is_admin || access?.is_high_command || (access?.commander_regiment_ids || []).length > 0
  );

  const [members, setMembers] = useState([]);
  const [search, setSearch] = useState("");
  const [loadingRoster, setLoadingRoster] = useState(true);
  const [rosterError, setRosterError] = useState(null);

  const [trainingReports, setTrainingReports] = useState([]);
  const [loadingReports, setLoadingReports] = useState(true);
  const [reportsError, setReportsError] = useState(null);

  useEffect(() => {
    if (!canViewRoster || !access?.recruit_regiment_id) {
      setLoadingRoster(false);
      return;
    }
    api
      .getMembers(token, access.recruit_regiment_id)
      .then(setMembers)
      .catch((e) => setRosterError(e.message))
      .finally(() => setLoadingRoster(false));
  }, [token, canViewRoster, access?.recruit_regiment_id]);

  useEffect(() => {
    api
      .listRecruitTrainingReports(token)
      .then(setTrainingReports)
      .catch((e) => setReportsError(e.message))
      .finally(() => setLoadingReports(false));
  }, [token]);

  const visibleMembers = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return members;
    return members.filter((m) =>
      [m.callsign, m.discord_username, m.username, m.service_id].some((v) => v?.toLowerCase().includes(query))
    );
  }, [members, search]);

  if (loadingRoster && loadingReports) return <PageLoading />;

  return (
    <div className="page-container">
      <h2>Рекрутская</h2>
      <p className="hint-text">
        Состав 17-го Передового Полка — рапорт «Курс молодого бойца» подаётся на странице «Рапорты»,
        дальнейшие повышения решаются на странице «Повышения».
      </p>

      {canViewRoster && (
        <>
          {!access?.recruit_regiment_id ? (
            <EmptyState text="17-й Передовой Полк не настроен." />
          ) : loadingRoster ? (
            <PageLoading />
          ) : (
            <>
              <label className="violation-filter-label">
                Поиск (позывной / ник / ИДН)
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Например: Demiyrg"
                />
              </label>

              {rosterError && <p className="error-text">{rosterError}</p>}

              {visibleMembers.length === 0 ? (
                <EmptyState text="Никого не найдено." />
              ) : (
                <div className="roster-table-wrap">
                  <table className="roster-table roster-table-wide">
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
        </>
      )}

      <div className="regiment-panel">
        <h3>Рапорты «Курс молодого бойца»</h3>
        {reportsError && <p className="error-text">{reportsError}</p>}
        {loadingReports ? (
          <PageLoading />
        ) : trainingReports.length === 0 ? (
          <EmptyState text="Рапортов пока нет." />
        ) : (
          <div className="report-list">
            {trainingReports.map((r) => (
              <div key={r.id} className="report-row">
                <div className="report-row-header">
                  <StatusBadge status={r.status} />
                  <span className="report-category">
                    {r.target_callsign || r.target_username || "неизвестный рекрут"}
                  </span>
                </div>
                <p className="member-report-date">{formatMskDate(r.created_at)} МСК</p>
                <p className="report-byline">Наставник: {formatFullNameAtRank(r.author, r.author_rank)}</p>
                <p className="report-row-content">{r.content}</p>
                {r.status === "rejected" && r.rejection_reason && (
                  <p className="report-rejection-reason">Причина отклонения: {r.rejection_reason}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
