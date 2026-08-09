import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { MemberSearchPicker } from "./MemberSearchPicker";

/** "Курс молодого бойца" — рапорт об обучении рекрута 17-го Передового Полка до
 * PVT, доступен любому Капралу+ независимо от своего формирования (см.
 * app/api/reports.py::is_recruit_promotion) — не только инструкторам, поэтому
 * это отдельная форма, а не ветка TrainingReportForm. Как и рапорт об обучении,
 * одобряется сразу при отправке (см. решение пользователя — должен стать PVT
 * одним действием). */
export function RecruitPromotionReportForm({ categoriesById, onSubmit, onCancel }) {
  const { token, regiments: allRegiments } = useAuth();
  const [members, setMembers] = useState([]);
  const [targetId, setTargetId] = useState("");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const recruitRegiment = allRegiments.find((r) => r.name === "17-ый Передовой Полк");
  const recruitCategory = Object.values(categoriesById).find(
    (c) => c.regiment_id === recruitRegiment?.id && c.is_recruit_promotion
  );

  useEffect(() => {
    if (!recruitRegiment) return;
    api
      .getViolationTargetCandidates(token, recruitRegiment.id)
      .then(setMembers)
      .catch(() => setMembers([]));
  }, [token, recruitRegiment]);

  const isValid = recruitRegiment && recruitCategory && targetId && content.trim();

  async function handleSubmit(e) {
    e.preventDefault();
    if (!isValid) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        regimentId: recruitRegiment.id,
        categoryId: recruitCategory.id,
        content: content.trim(),
        targetDiscordId: targetId,
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="report-form fade-in-up" onSubmit={handleSubmit}>
      <h3>Курс молодого бойца</h3>

      {!recruitRegiment || !recruitCategory ? (
        <p className="error-text">17-й Передовой Полк или категория «Курс молодого бойца» не настроены.</p>
      ) : (
        <>
          <label>
            Рекрут
            <MemberSearchPicker members={members} selectedId={targetId} onSelect={setTargetId} />
          </label>

          <label>
            Заметки об обучении
            <textarea rows={4} value={content} onChange={(e) => setContent(e.target.value)} />
          </label>
        </>
      )}

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
