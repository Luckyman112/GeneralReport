import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { EmptyState } from "../components/EmptyState";
import { PageLoading } from "../components/PageLoading";
import { ReportForm } from "../components/ReportForm";
import { formatFullName } from "../utils/formatName";

const TIER_LABELS = {
  curator: "Куратор",
  deputy: "Заместитель",
  instructor: "Инструктор",
};
// порядок блоков сверху вниз — куратор/зам/инструктор/просто состав (см. решение пользователя)
const TIER_ORDER = ["curator", "deputy", "instructor", null];

/** Страница ветки специализации (Медицина/Инженерия) — доступна только тем, кто
 * обучен на ветку (держит специализацию) или инструктору/DEP/CU этой ветки (см.
 * решение пользователя — не всем подряд, как Розыск). Иерархия (куратор -> зам
 * -> инструктор -> просто состав) + кросс-формационный ростер + подача рапорта
 * своей ветки прямо здесь — в общей форме "Создать рапорт" эти категории больше
 * не показываются вообще (см. ReportForm.jsx). */
export function DisciplineRosterPage({ discipline, title }) {
  const { token, access, regiments } = useAuth();
  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);

  // Обучен на ветку сам, либо инструктор/DEP/CU этой ветки — те же критерии,
  // что и на бэкенде (AccessContext.can_access_discipline), но тут только
  // сериализуемые поля из /me, метод с бэкенда сюда не доезжает
  const hasAccess = Boolean(
    access?.is_admin ||
      (access?.specialization_disciplines || []).includes(discipline) ||
      (access?.instructor_disciplines || []).includes(discipline) ||
      (access?.deputy_disciplines || []).includes(discipline)
  );
  const canSubmit = hasAccess;

  function load() {
    setLoading(true);
    setError(null);
    api
      .getDisciplineRoster(token, discipline)
      .then(setRoster)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (hasAccess) load();
    else setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, discipline, hasAccess]);

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

  async function handleCreate({ regimentId, categoryId, content, submit, images, participantDiscordIds }) {
    const report = await api.createReport(token, { regimentId, categoryId, content, submit, participantDiscordIds });
    for (const file of images) {
      await api.uploadReportImage(token, report.id, file);
    }
    setShowForm(false);
    load();
  }

  if (loading) return <PageLoading />;

  if (!hasAccess) {
    return (
      <div className="page-container">
        <h2>{title}</h2>
        <EmptyState text="Доступно только тем, кто обучен на эту ветку, или инструктору/заместителю/куратору ветки." />
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="reports-toolbar">
        <h2 style={{ margin: 0 }}>{title}</h2>
        {canSubmit && !showForm && (
          <button className="primary" onClick={() => setShowForm(true)}>
            Подать рапорт
          </button>
        )}
      </div>
      <p className="hint-text">Состав ветки по всему серверу, в порядке иерархии.</p>

      {error && <p className="error-text">{error}</p>}

      {showForm && (
        <ReportForm
          regiments={regiments}
          discipline={discipline}
          onSubmit={handleCreate}
          onCancel={() => setShowForm(false)}
        />
      )}

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
