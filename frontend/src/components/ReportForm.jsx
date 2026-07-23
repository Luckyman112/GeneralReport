import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { RosterFieldPicker } from "./RosterFieldPicker";

export function ReportForm({ regiments, onSubmit, onCancel }) {
  const { token } = useAuth();
  const [regimentId, setRegimentId] = useState(regiments[0]?.id ?? "");
  const [categories, setCategories] = useState([]);
  const [categoryId, setCategoryId] = useState("");
  const [members, setMembers] = useState([]);
  const [content, setContent] = useState("");
  const [fieldValues, setFieldValues] = useState({});
  const [images, setImages] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  const selectedCategory = useMemo(
    () => categories.find((c) => c.id === Number(categoryId)),
    [categories, categoryId]
  );
  const categoryFields = selectedCategory?.fields || [];

  useEffect(() => {
    if (!regimentId) return;
    // Защита от гонки: если формирование переключили ещё раз до того, как пришёл
    // ответ на предыдущий запрос, устаревший ответ не должен затирать актуальный список
    let ignore = false;
    api
      .listCategories(token, regimentId)
      .then((data) => {
        if (ignore) return;
        setCategories(data);
        setCategoryId(data[0]?.id ?? "");
      })
      .catch(() => {
        if (!ignore) setCategories([]);
      });
    api
      .getMembers(token, regimentId)
      .then((data) => {
        if (!ignore) setMembers(data);
      })
      .catch(() => {
        if (!ignore) setMembers([]);
      });
    return () => {
      ignore = true;
    };
  }, [token, regimentId]);

  useEffect(() => {
    setFieldValues({});
  }, [categoryId]);

  function isFieldFilled(field) {
    const value = fieldValues[field.name];
    return field.type === "roster" ? Boolean(value?.length) : Boolean(value?.trim());
  }

  function formatFieldValue(field) {
    const value = fieldValues[field.name];
    if (field.type === "roster") {
      const names = members.filter((m) => value?.includes(m.discord_id)).map((m) => m.username);
      return names.join(", ");
    }
    return value.trim();
  }

  async function handle(submit) {
    if (!regimentId) return;
    if (categories.length > 0 && !categoryId) return;

    let finalContent;
    if (categoryFields.length > 0) {
      if (categoryFields.some((f) => !isFieldFilled(f))) return;
      finalContent = categoryFields.map((f) => `${f.name}: ${formatFieldValue(f)}`).join("\n");
    } else {
      if (!content.trim()) return;
      finalContent = content.trim();
    }

    setSubmitting(true);
    try {
      await onSubmit({
        regimentId: Number(regimentId),
        categoryId: categoryId ? Number(categoryId) : null,
        content: finalContent,
        submit,
        images,
      });
    } finally {
      setSubmitting(false);
    }
  }

  function handleRemoveImage(index) {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <div className="report-form fade-in-up">
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

      {categories.length > 0 && (
        <label>
          Категория
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {categoryFields.length > 0 ? (
        categoryFields.map((field) =>
          field.type === "roster" ? (
            <label key={field.name}>
              {field.name}
              <RosterFieldPicker
                members={members}
                selectedIds={fieldValues[field.name] || []}
                onChange={(ids) => setFieldValues((prev) => ({ ...prev, [field.name]: ids }))}
              />
            </label>
          ) : (
            <label key={field.name}>
              {field.name}
              <input
                type="text"
                value={fieldValues[field.name] || ""}
                onChange={(e) => setFieldValues((prev) => ({ ...prev, [field.name]: e.target.value }))}
              />
            </label>
          )
        )
      ) : (
        <label>
          Текст рапорта
          <textarea
            rows={5}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Опишите ход операции..."
          />
        </label>
      )}

      <label>
        Картинки (скриншоты)
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          onChange={(e) => setImages((prev) => [...prev, ...Array.from(e.target.files)])}
        />
      </label>

      {images.length > 0 && (
        <ul className="image-picker-list">
          {images.map((file, i) => (
            <li key={`${file.name}-${i}`}>
              {file.name}
              <button type="button" onClick={() => handleRemoveImage(i)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

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
