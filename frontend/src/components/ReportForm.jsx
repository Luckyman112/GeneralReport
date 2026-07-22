import { useState } from "react";

export function ReportForm({ regiments, onSubmit, onCancel }) {
  const [regimentId, setRegimentId] = useState(regiments[0]?.id ?? "");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handle(submit) {
    if (!content.trim() || !regimentId) return;
    setSubmitting(true);
    try {
      await onSubmit({ regimentId: Number(regimentId), content: content.trim(), submit });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="report-form">
      <h3>Новый рапорт</h3>

      {regiments.length > 1 && (
        <label>
          Формирование
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
        Текст рапорта
        <textarea
          rows={5}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Опишите ход операции..."
        />
      </label>

      <div className="report-form-actions">
        <button disabled={submitting} onClick={() => handle(false)}>
          Сохранить черновик
        </button>
        <button disabled={submitting} className="primary" onClick={() => handle(true)}>
          Отправить
        </button>
        <button disabled={submitting} className="ghost" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </div>
  );
}
