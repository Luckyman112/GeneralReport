import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

const FIELD_TYPE_LABELS = {
  text: "Текст",
  roster: "Список состава",
};

function CategoryRow({ category, onChanged, onDeleted }) {
  const { token } = useAuth();
  const [newField, setNewField] = useState("");
  const [newFieldType, setNewFieldType] = useState("text");
  const [pointsDraft, setPointsDraft] = useState(category.points ?? "");
  const [error, setError] = useState(null);

  async function handleAddField(e) {
    e.preventDefault();
    if (!newField.trim()) return;
    try {
      await api.updateCategory(token, category.regiment_id, category.id, {
        fields: [...category.fields, { name: newField.trim(), type: newFieldType }],
      });
      setNewField("");
      setNewFieldType("text");
      onChanged();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleRemoveField(fieldName) {
    try {
      await api.updateCategory(token, category.regiment_id, category.id, {
        fields: category.fields.filter((f) => f.name !== fieldName),
      });
      onChanged();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleSavePoints() {
    try {
      await api.updateCategory(token, category.regiment_id, category.id, {
        points: pointsDraft === "" ? null : Number(pointsDraft),
      });
      onChanged();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <li className="category-row">
      <div className="category-row-header">
        <strong>{category.name}</strong>
        <button className="ghost" onClick={() => onDeleted(category.id)}>
          Удалить категорию
        </button>
      </div>
      {category.fields.length > 0 && (
        <div className="field-tags">
          {category.fields.map((f) => (
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
      <form onSubmit={handleAddField} className="add-field-form">
        <input
          type="text"
          placeholder="+ поле (например «Время поста»)"
          value={newField}
          onChange={(e) => setNewField(e.target.value)}
        />
        <select value={newFieldType} onChange={(e) => setNewFieldType(e.target.value)}>
          <option value="text">Текст</option>
          <option value="roster">Список состава</option>
        </select>
        <button type="submit">Добавить поле</button>
      </form>

      <div className="points-inline">
        <label className="points-inline-label">
          Баллы за рапорт
          <input
            type="number"
            placeholder="не указано"
            value={pointsDraft}
            onChange={(e) => setPointsDraft(e.target.value)}
          />
        </label>
        <button type="button" onClick={handleSavePoints}>
          Сохранить баллы
        </button>
      </div>
      <p className="hint-text">
        Начисляются автоматически при одобрении рапорта этой категории, если баллы ещё не
        выставлены вручную.
      </p>

      {error && <p className="error-text">{error}</p>}
    </li>
  );
}

/** Настройка категорий рапортов и их полей — отдельная модалка для командира,
 * открывается кнопкой "Категории и поля" над списком рапортов. Поле категории может
 * быть обычным текстом или выплывающим списком состава (мульти-выбор бойцов). */
export function CategoryManagerModal({ regiments, onClose }) {
  const { token } = useAuth();
  const [regimentId, setRegimentId] = useState(regiments[0]?.id ?? "");
  const [categories, setCategories] = useState([]);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryFields, setNewCategoryFields] = useState([]);
  const [newCategoryPoints, setNewCategoryPoints] = useState("");
  const [newFieldDraft, setNewFieldDraft] = useState("");
  const [newFieldDraftType, setNewFieldDraftType] = useState("text");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  // Защита от гонки: устаревший ответ (для уже покинутого формирования) не должен
  // затирать список категорий актуально выбранного
  const requestIdRef = useRef(0);

  async function load(id) {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const data = await api.listCategories(token, id);
      if (requestIdRef.current === requestId) setCategories(data);
    } catch (e) {
      if (requestIdRef.current === requestId) setError(e.message);
    } finally {
      if (requestIdRef.current === requestId) setLoading(false);
    }
  }

  useEffect(() => {
    if (regimentId) load(regimentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, regimentId]);

  function handleAddFieldDraft() {
    if (!newFieldDraft.trim()) return;
    setNewCategoryFields((prev) => [...prev, { name: newFieldDraft.trim(), type: newFieldDraftType }]);
    setNewFieldDraft("");
    setNewFieldDraftType("text");
  }

  function handleRemoveFieldDraft(fieldName) {
    setNewCategoryFields((prev) => prev.filter((f) => f.name !== fieldName));
  }

  async function handleCreateCategory(e) {
    e.preventDefault();
    if (!newCategoryName.trim()) return;
    try {
      await api.createCategory(token, regimentId, {
        name: newCategoryName.trim(),
        fields: newCategoryFields,
        points: newCategoryPoints === "" ? null : Number(newCategoryPoints),
      });
      setNewCategoryName("");
      setNewCategoryFields([]);
      setNewCategoryPoints("");
      await load(regimentId);
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDeleteCategory(categoryId) {
    try {
      await api.deleteCategory(token, regimentId, categoryId);
      await load(regimentId);
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal category-manager-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Категории и поля рапортов</h3>

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

        {error && <p className="error-text">{error}</p>}

        {loading ? (
          <p>Загрузка...</p>
        ) : (
          <>
            <ul className="category-rows">
              {categories.map((c) => (
                <CategoryRow
                  key={c.id}
                  category={{ ...c, regiment_id: regimentId }}
                  onChanged={() => load(regimentId)}
                  onDeleted={handleDeleteCategory}
                />
              ))}
            </ul>

            <form onSubmit={handleCreateCategory} className="new-category-form">
              <h5>Новая категория</h5>
              <input
                type="text"
                placeholder="Название категории (например «Пост»)"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
              />

              {newCategoryFields.length > 0 && (
                <div className="field-tags">
                  {newCategoryFields.map((f) => (
                    <span key={f.name} className="field-tag">
                      {f.name}
                      <span className="field-tag-type">{FIELD_TYPE_LABELS[f.type] || f.type}</span>
                      <button type="button" onClick={() => handleRemoveFieldDraft(f.name)}>
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
                  value={newFieldDraft}
                  onChange={(e) => setNewFieldDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddFieldDraft();
                    }
                  }}
                />
                <select value={newFieldDraftType} onChange={(e) => setNewFieldDraftType(e.target.value)}>
                  <option value="text">Текст</option>
                  <option value="roster">Список состава</option>
                </select>
                <button type="button" onClick={handleAddFieldDraft}>
                  + поле
                </button>
              </div>

              <label>
                Баллы за рапорт (необязательно)
                <input
                  type="number"
                  placeholder="не указано"
                  value={newCategoryPoints}
                  onChange={(e) => setNewCategoryPoints(e.target.value)}
                />
              </label>

              <button type="submit" className="primary">
                Создать категорию
              </button>
            </form>
          </>
        )}

        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
