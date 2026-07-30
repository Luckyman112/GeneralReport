import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { MemberSearchPicker } from "./MemberSearchPicker";

/** Рапорт об обучении — инструктор фиксирует, что провёл бойцу обучение конкретной
 * специализации. Работает как рапорт о задержании: живёт в разделе "Рапорты",
 * проходит обычный путь одобрения; при одобрении специализация выдаётся бойцу
 * автоматически (см. app/api/reports.py). Доступна только инструкторам/админу. */
export function TrainingReportForm({ regiments, categoriesById, onSubmit, onCancel }) {
  const { token, regiments: allRegiments } = useAuth();
  const [regimentId, setRegimentId] = useState(regiments[0]?.id ?? "");
  const [targetRegimentId, setTargetRegimentId] = useState("");
  const [members, setMembers] = useState([]);
  const [targetId, setTargetId] = useState("");
  const [specializations, setSpecializations] = useState([]);
  const [specializationId, setSpecializationId] = useState("");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.listSpecializations(token).then(setSpecializations).catch(() => setSpecializations([]));
  }, [token]);

  useEffect(() => {
    if (!targetRegimentId) {
      setMembers([]);
      return;
    }
    api
      .getViolationTargetCandidates(token, targetRegimentId)
      .then(setMembers)
      .catch(() => setMembers([]));
    setTargetId("");
  }, [token, targetRegimentId]);

  const trainingCategory = Object.values(categoriesById).find(
    (c) => c.regiment_id === Number(regimentId) && c.is_training
  );

  const isValid = trainingCategory && targetRegimentId && targetId && specializationId && content.trim();

  async function handleSubmit(e) {
    e.preventDefault();
    if (!isValid) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        regimentId: Number(regimentId),
        categoryId: trainingCategory.id,
        content: content.trim(),
        targetDiscordId: targetId,
        trainingSpecializationId: Number(specializationId),
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="report-form fade-in-up" onSubmit={handleSubmit}>
      <h3>Рапорт об обучении</h3>

      {regiments.length > 1 && (
        <label>
          Формирование (от чьего лица подаётся)
          <select value={regimentId} onChange={(e) => setRegimentId(e.target.value)}>
            {regiments.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <label>
        Формирование обучаемого
        <select value={targetRegimentId} onChange={(e) => setTargetRegimentId(e.target.value)}>
          <option value="">— выбрать —</option>
          {allRegiments.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>

      <label>
        Кому провели обучение
        <MemberSearchPicker members={members} selectedId={targetId} onSelect={setTargetId} />
      </label>

      <label>
        Специализация
        <select value={specializationId} onChange={(e) => setSpecializationId(e.target.value)}>
          <option value="">— выбрать —</option>
          {specializations.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} — {s.name}
            </option>
          ))}
        </select>
      </label>

      <label>
        Заметки об обучении
        <textarea rows={4} value={content} onChange={(e) => setContent(e.target.value)} />
      </label>

      {error && <p className="error-text">{error}</p>}

      <div className="report-form-actions">
        <button className="primary" type="submit" disabled={submitting || !isValid}>
          Отправить
        </button>
        <button className="ghost" type="button" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </form>
  );
}
