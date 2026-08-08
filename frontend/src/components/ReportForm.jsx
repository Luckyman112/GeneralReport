import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { isManualEntry, manualEntryName, RosterFieldPicker } from "./RosterFieldPicker";

// Категории дисциплин (медик/пилот/инженер) — в общей форме не показываются
// вообще (подача перенесена на страницы Специализации, см. решение
// пользователя); discipline-проп используется теми самыми страницами, чтобы
// показать ТОЛЬКО категории своей ветки. required_specialization категории
// рапорта обычно указывает на БАЗОВУЮ специализацию (например "Медик"), а её
// собственный Specialization.category — это категория лимита состава ("class"
// и т.п.), НЕ discipline — поэтому вдобавок к category сверяем ещё и code
// корневой специализации ветки.
const DISCIPLINE_CATEGORIES = ["medic", "pilot", "engineer"];
const DISCIPLINE_ROOT_CODES = { medic: ["MED"], engineer: ["ENG"], pilot: ["PIL"] };

function categoryDiscipline(category) {
  const spec = category.required_specialization;
  if (!spec) return null;
  if (DISCIPLINE_CATEGORIES.includes(spec.category)) return spec.category;
  for (const [discipline, codes] of Object.entries(DISCIPLINE_ROOT_CODES)) {
    if (codes.includes(spec.code)) return discipline;
  }
  return null;
}

export function ReportForm({ regiments, onSubmit, onCancel, discipline }) {
  const { token, user, activeCharacter, access } = useAuth();
  const preferredRegimentId = activeCharacter?.regiment.id;
  const defaultRegimentId = regiments.some((r) => r.id === preferredRegimentId)
    ? preferredRegimentId
    : regiments[0]?.id ?? "";
  const [regimentId, setRegimentId] = useState(defaultRegimentId);
  const [categories, setCategories] = useState([]);
  const [categoryId, setCategoryId] = useState("");
  const [members, setMembers] = useState([]);
  const [crossRegimentMembersByField, setCrossRegimentMembersByField] = useState({});
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
        // Задержание/обучение оформляются отдельными формами (кнопка "Рапорт о
        // задержании" и Инструкторская), повышение создаётся автоматически —
        // вручную выбрать их в обычной форме нельзя
        const squadIds = new Set(access?.squad_ids || []);
        const selectable = data.filter((c) => {
          if (c.is_detention || c.is_promotion || c.is_demotion || c.is_training) return false;
          if (discipline) return categoryDiscipline(c) === discipline;
          // общая форма — категории дисциплин сюда не попадают, подача только
          // со страниц Специализации (Медицина/Инженерия и т.п.)
          if (categoryDiscipline(c) !== null) return false;
          // отрядные категории (например "Рапорт о разведке") видны только
          // участникам этого отряда — см. решение пользователя
          if (c.required_squad && !squadIds.has(c.required_squad.id)) return false;
          return true;
        });
        setCategories(selectable);
        setCategoryId(selectable[0]?.id ?? "");
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
  }, [token, regimentId, discipline]);

  useEffect(() => {
    // roster-поля с default_self ("я сам") — сразу подставляют подающего, можно
    // сменить/убрать вручную как обычный выбор (см. решение пользователя)
    const initial = {};
    for (const f of categoryFields) {
      if (f.type === "roster" && f.default_self && user?.discord_id) {
        initial[f.name] = [user.discord_id];
      }
    }
    setFieldValues(initial);

    // roster fields can also search other regiments' rosters (allowed_regiment_ids)
    let ignore = false;
    const rosterFields = categoryFields.filter((f) => f.type === "roster" && f.allowed_regiment_ids?.length > 0);
    if (rosterFields.length === 0) {
      setCrossRegimentMembersByField({});
      return undefined;
    }
    Promise.all(
      rosterFields.map(async (field) => {
        const lists = await Promise.all(
          field.allowed_regiment_ids.map((rid) =>
            api
              .getMembers(token, rid)
              .then((data) => data.map((m) => ({ ...m, _regimentName: regiments.find((r) => r.id === rid)?.name })))
              .catch(() => [])
          )
        );
        return [field.name, lists.flat()];
      })
    ).then((entries) => {
      if (!ignore) setCrossRegimentMembersByField(Object.fromEntries(entries));
    });
    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId]);

  function isFieldFilled(field) {
    const value = fieldValues[field.name];
    return field.type === "roster" ? Boolean(value?.length) : Boolean(value?.trim());
  }

  // own roster + cross-regiment members, own wins on duplicates
  function rosterMembersForField(field) {
    const cross = crossRegimentMembersByField[field.name] || [];
    if (cross.length === 0) return members;
    const ownIds = new Set(members.map((m) => m.discord_id));
    return [...members, ...cross.filter((m) => !ownIds.has(m.discord_id))];
  }

  function formatFieldValue(field) {
    const value = fieldValues[field.name];
    if (field.type === "roster") {
      const names = rosterMembersForField(field)
        .filter((m) => value?.includes(m.discord_id))
        .map((m) => (m._regimentName ? `${m.username} (${m._regimentName})` : m.username));
      const manualNames = (value || [])
        .filter(isManualEntry)
        .map((id) => `${manualEntryName(id)} (не в составе)`);
      return [...names, ...manualNames].join(", ");
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

    // Все, кто указан в ростер-полях категории (не важно, сколько таких полей) —
    // потенциальные получатели баллов за участие (см. ReportCategory.participant_points)
    const participantDiscordIds = [
      ...new Set(
        categoryFields
          .filter((f) => f.type === "roster")
          .flatMap((f) => fieldValues[f.name] || [])
          .filter((id) => !isManualEntry(id))
      ),
    ];

    setSubmitting(true);
    try {
      await onSubmit({
        regimentId: Number(regimentId),
        categoryId: categoryId ? Number(categoryId) : null,
        content: finalContent,
        submit,
        images,
        participantDiscordIds,
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
                members={rosterMembersForField(field)}
                selectedIds={fieldValues[field.name] || []}
                onChange={(ids) => setFieldValues((prev) => ({ ...prev, [field.name]: ids }))}
                allowManual={field.allow_manual}
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
