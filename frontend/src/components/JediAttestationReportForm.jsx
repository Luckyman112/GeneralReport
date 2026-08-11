import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { MemberSearchPicker } from "./MemberSearchPicker";

/** "Аттестация" — рапорт о прохождении падаваном 6-го и последнего испытания
 * (см. app/api/reports.py::is_jedi_attestation_report) — клон
 * JediTrialReportForm.jsx. Одобрение сразу меняет ранг падавана на Рыцаря
 * (см. решение пользователя), отдельного шага не требуется. */
export function JediAttestationReportForm({ categoriesById, onSubmit, onCancel }) {
  const { token, regiments: allRegiments } = useAuth();
  const [members, setMembers] = useState([]);
  const [targetId, setTargetId] = useState("");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const jediRegiment = allRegiments.find((r) => r.is_jedi_order);
  const attestationCategory = Object.values(categoriesById).find(
    (c) => c.regiment_id === jediRegiment?.id && c.is_jedi_attestation_report
  );

  useEffect(() => {
    if (!jediRegiment) return;
    api
      .getViolationTargetCandidates(token, jediRegiment.id)
      .then(setMembers)
      .catch(() => setMembers([]));
  }, [token, jediRegiment]);

  const isValid = jediRegiment && attestationCategory && targetId && content.trim();

  async function handleSubmit(e) {
    e.preventDefault();
    if (!isValid) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        regimentId: jediRegiment.id,
        categoryId: attestationCategory.id,
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
      <h3>Аттестация</h3>

      {!jediRegiment || !attestationCategory ? (
        <p className="error-text">Орден Джедаев или категория «Аттестация» не настроены.</p>
      ) : (
        <>
          <label>
            Падаван
            <MemberSearchPicker members={members} selectedId={targetId} onSelect={setTargetId} />
          </label>

          <label>
            Заметки об аттестации
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
