import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { EmptyState } from "../components/EmptyState";
import { InlineSpinner } from "../components/InlineSpinner";
import { formatMskDate } from "../utils/formatDate";
import { formatFullName } from "../utils/formatName";

const DISCIPLINE_LABELS = {
  medic: "Медицина",
  pilot: "Пилотирование",
  engineer: "Инженерия",
};

/** Кабинет DEP/CU дисциплины (медик/пилот/инженер) — кросс-формационный ростер
 * своей ветки и точечное объявление только по ней. Каталог специализаций,
 * запрет на обучение и категории рапортов дисциплины управляются на своих
 * обычных страницах (Инструкторская / Настройки / Формирование) — там же
 * добавлены DEP/CU-права, отдельного UI для них здесь нет. */
export function DisciplinePage() {
  const { token, access } = useAuth();
  // Админ не обязан состоять в дисциплине сам — даём выбрать любую, для
  // остальных доступны только те ветки, где они DEP/CU (см. is_discipline_deputy)
  const ownDisciplines = useMemo(
    () => (access?.is_admin ? Object.keys(DISCIPLINE_LABELS) : access?.deputy_disciplines || []),
    [access]
  );
  const [discipline, setDiscipline] = useState(ownDisciplines[0] || "");
  const [roster, setRoster] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sentCount, setSentCount] = useState(null);
  const [sendError, setSendError] = useState(null);

  useEffect(() => {
    if (!discipline && ownDisciplines.length > 0) setDiscipline(ownDisciplines[0]);
  }, [ownDisciplines, discipline]);

  useEffect(() => {
    if (!discipline) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    api
      .getDisciplineRoster(token, discipline)
      .then(setRoster)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token, discipline]);

  async function handleSend(e) {
    e.preventDefault();
    if (!title.trim() || !body.trim() || !discipline) return;
    setSending(true);
    setSendError(null);
    setSentCount(null);
    try {
      const result = await api.sendDisciplineBroadcast(token, { title: title.trim(), body: body.trim(), discipline });
      setSentCount(result.recipients);
      setTitle("");
      setBody("");
    } catch (e) {
      setSendError(e.message);
    } finally {
      setSending(false);
    }
  }

  if (ownDisciplines.length === 0) {
    return (
      <div className="page-container">
        <h2>Дисциплина</h2>
        <EmptyState text="Доступно только заместителям/кураторам дисциплины." />
      </div>
    );
  }

  return (
    <div className="page-container">
      <h2>Дисциплина</h2>
      <p className="hint-text">
        Кросс-формационный обзор своей ветки и точечное объявление её составу. Каталог специализаций и запрет на
        обучение — в Инструкторской, категории рапортов — в настройках формирования.
      </p>

      {ownDisciplines.length > 1 && (
        <div className="reports-toolbar reports-toolbar-filters">
          <select value={discipline} onChange={(e) => setDiscipline(e.target.value)}>
            {ownDisciplines.map((d) => (
              <option key={d} value={d}>
                {DISCIPLINE_LABELS[d] || d}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="regiment-panel">
        <h3>Состав ветки — {DISCIPLINE_LABELS[discipline] || discipline}</h3>
        {loading ? (
          <InlineSpinner />
        ) : error ? (
          <p className="error-text">{error}</p>
        ) : roster.length === 0 ? (
          <EmptyState text="В этой дисциплине пока никого нет." />
        ) : (
          <table className="roster-table roster-table-wide">
            <thead>
              <tr>
                <th>Боец</th>
                <th>Специализация</th>
                <th>Формирование</th>
                <th>Выдано</th>
              </tr>
            </thead>
            <tbody>
              {roster.map((entry, idx) => (
                <tr key={`${entry.user.id}-${entry.specialization.id}-${idx}`}>
                  <td>{formatFullName(entry.user)}</td>
                  <td>
                    {entry.specialization.code} — {entry.specialization.name}
                  </td>
                  <td>{entry.regiment_names.join(", ") || "—"}</td>
                  <td>{formatMskDate(entry.granted_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="regiment-panel">
        <h3>Объявление составу ветки</h3>
        <form onSubmit={handleSend}>
          <label>
            Заголовок
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label>
            Текст
            <textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
          </label>
          {sendError && <p className="error-text">{sendError}</p>}
          {sentCount !== null && <p className="hint-text">Отправлено {sentCount} бойцам.</p>}
          <button className="primary" type="submit" disabled={sending || !title.trim() || !body.trim()}>
            {sending ? "Отправка…" : "Отправить"}
          </button>
        </form>
      </div>
    </div>
  );
}
