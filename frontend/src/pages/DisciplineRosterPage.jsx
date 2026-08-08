import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { EmptyState } from "../components/EmptyState";
import { PageLoading } from "../components/PageLoading";
import { formatFullName } from "../utils/formatName";

const TIER_LABELS = {
  curator: "Куратор",
  deputy: "Заместитель",
  instructor: "Инструктор",
};
// порядок блоков сверху вниз — куратор/зам/инструктор/просто состав (см. решение пользователя)
const TIER_ORDER = ["curator", "deputy", "instructor", null];

/** Открытая всем страница ветки специализации (Медицина/Инженерия/Пилотирование)
 * — иерархия (куратор -> зам -> инструктор -> просто состав) + кросс-формационный
 * ростер. В отличие от /discipline (только для DEP/CU своей ветки, с формой
 * объявления), эта страница просто показывает состав ветки; подать рапорт —
 * обычным образом на странице Рапортов (категории, открытые под специализацию,
 * уже фильтруются там сами). */
export function DisciplineRosterPage({ discipline, title }) {
  const { token } = useAuth();
  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api
      .getDisciplineRoster(token, discipline)
      .then(setRoster)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token, discipline]);

  const grouped = useMemo(() => {
    const byUser = new Map();
    for (const entry of roster) {
      const existing = byUser.get(entry.user.id);
      if (existing) {
        existing.specializations.push(entry.specialization);
      } else {
        byUser.set(entry.user.id, {
          user: entry.user,
          tier: entry.tier,
          regimentNames: entry.regiment_names,
          grantedAt: entry.granted_at,
          specializations: [entry.specialization],
        });
      }
    }
    const people = [...byUser.values()];
    const buckets = new Map(TIER_ORDER.map((t) => [t, []]));
    for (const p of people) {
      (buckets.get(p.tier) || buckets.get(null)).push(p);
    }
    for (const list of buckets.values()) {
      list.sort((a, b) => a.user.username.localeCompare(b.user.username));
    }
    return buckets;
  }, [roster]);

  if (loading) return <PageLoading />;

  return (
    <div className="page-container">
      <h2>{title}</h2>
      <p className="hint-text">
        Состав ветки по всему серверу, в порядке иерархии. Подать рапорт — как обычно, на странице{" "}
        <Link to="/reports">Рапорты</Link>.
      </p>

      {error && <p className="error-text">{error}</p>}

      {roster.length === 0 ? (
        <EmptyState text="В этой ветке пока никого нет." />
      ) : (
        TIER_ORDER.map((tier) => {
          const people = grouped.get(tier) || [];
          if (people.length === 0) return null;
          return (
            <div key={tier ?? "none"} className="regiment-panel">
              <h3>{tier ? TIER_LABELS[tier] : "Состав"}</h3>
              <table className="roster-table roster-table-wide">
                <thead>
                  <tr>
                    <th>Боец</th>
                    <th>Специализации</th>
                    <th>Формирование</th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((p) => (
                    <tr key={p.user.id}>
                      <td>{formatFullName(p.user)}</td>
                      <td>{p.specializations.map((s) => s.code).join(", ")}</td>
                      <td>{p.regimentNames.join(", ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })
      )}
    </div>
  );
}
