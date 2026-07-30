import { useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { InfoHint } from "./Tooltip";

const FIELD_TYPE_LABELS = {
  text: "Текст",
  roster: "Список состава",
};

/** Создание/редактирование обязательного требования по повышению — действует
 * сразу для ВСЕХ формирований (см. app/crud/promotion.py::create_mandatory_category_requirement/
 * update_mandatory_category_requirement). initial=null — создание нового;
 * initial={groupId, rankId, categoryName, fields, countRequired, minRankId, commanderOnly} —
 * редактирование существующего (по mandatory_group_id). */
export function MandatoryRequirementModal({ ranks, existingCategoryNames, initial, onClose, onSaved }) {
  const { token } = useAuth();
  const isEdit = Boolean(initial);
  const [rankId, setRankId] = useState(initial?.rankId ?? "");
  const [categoryName, setCategoryName] = useState(initial?.categoryName ?? "");
  const [fieldsList, setFieldsList] = useState(initial?.fields ?? []);
  const [fieldDraft, setFieldDraft] = useState("");
  const [fieldDraftType, setFieldDraftType] = useState("text");
  const [countRequired, setCountRequired] = useState(initial?.countRequired ?? 1);
  const [minRankId, setMinRankId] = useState(initial?.minRankId ?? "");
  const [commanderOnly, setCommanderOnly] = useState(initial?.commanderOnly ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  function handleAddField() {
    if (!fieldDraft.trim()) return;
    setFieldsList((prev) => [...prev, { name: fieldDraft.trim(), type: fieldDraftType }]);
    setFieldDraft("");
    setFieldDraftType("text");
  }

  function handleRemoveField(name) {
    setFieldsList((prev) => prev.filter((f) => f.name !== name));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!rankId || !categoryName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        rankId: Number(rankId),
        categoryName: categoryName.trim(),
        categoryFields: fieldsList,
        countRequired: Number(countRequired) || 1,
        categoryMinRankId: minRankId === "" ? null : Number(minRankId),
        categoryCommanderOnly: commanderOnly,
      };
      if (isEdit) {
        await api.updateMandatoryCategoryRequirement(token, initial.groupId, payload);
      } else {
        await api.createMandatoryCategoryRequirement(token, payload);
      }
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{isEdit ? "Изменить обязательное требование" : "Новое обязательное требование"}</h3>
        <p className="hint-text">Действует сразу для ВСЕХ формирований.</p>

        <form onSubmit={handleSubmit}>
          <label>
            Звание, для которого обязательно
            <select value={rankId} onChange={(e) => setRankId(e.target.value)}>
              <option value="">— выбрать —</option>
              {ranks.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code} — {r.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Название категории
            <input
              type="text"
              value={categoryName}
              onChange={(e) => setCategoryName(e.target.value)}
              list={isEdit ? undefined : "mandatory-category-names-modal"}
            />
          </label>
          {!isEdit && (
            <datalist id="mandatory-category-names-modal">
              {existingCategoryNames.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          )}

          <label>
            Поля рапорта этой категории
            <InfoHint text="Пусто — обычный рапорт свободным текстом. Если категория с этим именем уже есть в каких-то формированиях, поля обновятся сразу везде." />
          </label>
          {fieldsList.length > 0 && (
            <div className="field-tags">
              {fieldsList.map((f) => (
                <span key={f.name} className="field-tag">
                  {f.name}
                  <span className="field-tag-type">{FIELD_TYPE_LABELS[f.type] || f.type}</span>
                  <button type="button" onClick={() => handleRemoveField(f.name)}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="add-field-form">
            <input
              type="text"
              placeholder="+ поле (например «Время поста»)"
              value={fieldDraft}
              onChange={(e) => setFieldDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddField();
                }
              }}
            />
            <select value={fieldDraftType} onChange={(e) => setFieldDraftType(e.target.value)}>
              <option value="text">Текст</option>
              <option value="roster">Список состава</option>
            </select>
            <button type="button" onClick={handleAddField}>
              + поле
            </button>
          </div>

          <label>
            Нужно рапортов
            <input
              type="number"
              min={1}
              value={countRequired}
              onChange={(e) => setCountRequired(e.target.value)}
              style={{ width: "5rem" }}
            />
          </label>

          <label>
            Мин. звание для подачи
            <InfoHint text="Не 'обязательно для повышения' (это задаётся полем выше), а отдельное ограничение — с какого звания рапорт этой категории вообще можно подать. Пусто — без ограничения." />
            <select value={minRankId} onChange={(e) => setMinRankId(e.target.value)}>
              <option value="">не ограничено</option>
              {ranks.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code} — {r.name}
                </option>
              ))}
            </select>
          </label>

          <label className="checkbox-label">
            <input type="checkbox" checked={commanderOnly} onChange={(e) => setCommanderOnly(e.target.checked)} />
            Только заместитель+/командир
          </label>

          {error && <p className="error-text">{error}</p>}

          <div className="modal-actions">
            <button className="primary" type="submit" disabled={saving}>
              {isEdit ? "Сохранить" : "Добавить"}
            </button>
            <button className="ghost" type="button" onClick={onClose}>
              Отмена
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
