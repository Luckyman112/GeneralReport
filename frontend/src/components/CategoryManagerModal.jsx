import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { InlineSpinner } from "./InlineSpinner";
import { InfoHint } from "./Tooltip";

const FIELD_TYPE_LABELS = {
  text: "Текст",
  roster: "Список состава",
};

function RosterAllowedRegiments({ allRegiments, currentRegimentId, selectedIds, onChange }) {
  const otherRegiments = allRegiments.filter((r) => r.id !== Number(currentRegimentId));
  if (otherRegiments.length === 0) return null;
  const allSelected = otherRegiments.every((r) => selectedIds.includes(r.id));

  function toggle(id) {
    onChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
  }

  function toggleAll() {
    onChange(allSelected ? [] : otherRegiments.map((r) => r.id));
  }

  return (
    <div className="field-tags">
      <span>
        Ещё формирования
        <InfoHint text="Список состава этого поля будет искать бойцов ещё и в отмеченных формированиях, не только в своём. Например для общих тренировок — отметьте «Все формирования»." />
      </span>
      <label className="field-tag" style={{ cursor: "pointer" }}>
        <input type="checkbox" checked={allSelected} onChange={toggleAll} style={{ marginRight: "0.3rem" }} />
        Все формирования
      </label>
      {otherRegiments.map((r) => (
        <label key={r.id} className="field-tag" style={{ cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={selectedIds.includes(r.id)}
            onChange={() => toggle(r.id)}
            style={{ marginRight: "0.3rem" }}
          />
          {r.name}
        </label>
      ))}
    </div>
  );
}

function CategoryRow({ category, tiers, allRegiments, specializations, squads, onChanged, onDeleted }) {
  const { token } = useAuth();
  const [newField, setNewField] = useState("");
  const [newFieldType, setNewFieldType] = useState("text");
  const [newFieldAllowedRegimentIds, setNewFieldAllowedRegimentIds] = useState([]);
  const [newFieldDefaultSelf, setNewFieldDefaultSelf] = useState(false);
  const [pointsDraft, setPointsDraft] = useState(category.points ?? "");
  const [participantPointsDraft, setParticipantPointsDraft] = useState(category.participant_points ?? "");
  const [minRankDraft, setMinRankDraft] = useState(category.min_rank?.id ?? "");
  const [commanderOnlyDraft, setCommanderOnlyDraft] = useState(category.commander_only ?? false);
  const [requiredSpecializationDraft, setRequiredSpecializationDraft] = useState(
    category.required_specialization?.id ?? ""
  );
  const [openToLeadershipDraft, setOpenToLeadershipDraft] = useState(category.open_to_regiment_leadership ?? false);
  const [requiredSquadDraft, setRequiredSquadDraft] = useState(category.required_squad?.id ?? "");
  const [error, setError] = useState(null);

  async function handleAddField(e) {
    e.preventDefault();
    if (!newField.trim()) return;
    try {
      const field = { name: newField.trim(), type: newFieldType };
      if (newFieldType === "roster") {
        field.allowed_regiment_ids = newFieldAllowedRegimentIds;
        field.default_self = newFieldDefaultSelf;
      }
      await api.updateCategory(token, category.regiment_id, category.id, {
        fields: [...category.fields, field],
      });
      setNewField("");
      setNewFieldType("text");
      setNewFieldAllowedRegimentIds([]);
      setNewFieldDefaultSelf(false);
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
        participant_points: participantPointsDraft === "" ? null : Number(participantPointsDraft),
      });
      onChanged();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleSaveRestrictions() {
    try {
      await api.updateCategory(token, category.regiment_id, category.id, {
        min_rank_id: minRankDraft === "" ? null : Number(minRankDraft),
        commander_only: commanderOnlyDraft,
        required_specialization_id: requiredSpecializationDraft === "" ? null : Number(requiredSpecializationDraft),
        open_to_regiment_leadership: openToLeadershipDraft,
        required_squad_id: requiredSquadDraft === "" ? null : Number(requiredSquadDraft),
      });
      onChanged();
    } catch (e) {
      setError(e.message);
    }
  }

  // system categories have a fixed structure (target/specialization fields), not
  // the generic user-defined "fields" array — editing it here would do nothing
  const isSystemCategory =
    category.is_detention || category.is_promotion || category.is_demotion || category.is_training;
  // only the filer earns points here (detaining officer / instructor) — no
  // participant/roster mechanism applies to these two
  const hasParticipantPoints = !category.is_detention && !category.is_training;

  return (
    <li className="category-row">
      <div className="category-row-header">
        <strong>
          {category.name}
          {category.is_detention && <span className="detention-badge">задержание (системная)</span>}
          {category.is_promotion && <span className="detention-badge">повышение (системная)</span>}
          {category.is_demotion && <span className="detention-badge">понижение (системная)</span>}
          {category.is_training && <span className="detention-badge">обучение (системная)</span>}
          {category.required_squad && <span className="hint-text"> — отряд «{category.required_squad.name}»</span>}
        </strong>
        {!isSystemCategory && (
          <button className="ghost" onClick={() => onDeleted(category.id)}>
            Удалить категорию
          </button>
        )}
      </div>
      {!isSystemCategory && (
        <>
          {category.fields.length > 0 && (
            <div className="field-tags">
              {category.fields.map((f) => (
                <span key={f.name} className="field-tag">
                  {f.name}
                  <span className="field-tag-type">{FIELD_TYPE_LABELS[f.type] || f.type}</span>
                  {f.type === "roster" && f.default_self && <span className="hint-text"> (я сам)</span>}
                  {f.type === "roster" && f.allowed_regiment_ids?.length > 0 && (
                    <span className="hint-text">
                      {" "}
                      (+{f.allowed_regiment_ids
                        .map((id) => allRegiments.find((r) => r.id === id)?.name)
                        .filter(Boolean)
                        .join(", ")})
                    </span>
                  )}
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
          {newFieldType === "roster" && (
            <>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={newFieldDefaultSelf}
                  onChange={(e) => setNewFieldDefaultSelf(e.target.checked)}
                />
                По умолчанию — я сам
                <InfoHint text="При открытии формы поле сразу подставит того, кто подаёт рапорт — можно сменить или убрать вручную перед отправкой." />
              </label>
              <RosterAllowedRegiments
                allRegiments={allRegiments}
                currentRegimentId={category.regiment_id}
                selectedIds={newFieldAllowedRegimentIds}
                onChange={setNewFieldAllowedRegimentIds}
              />
            </>
          )}
        </>
      )}

      <div className="points-inline">
        <label className="points-inline-label">
          {category.is_training ? "Баллы за специализацию" : "Баллы за рапорт"}
          <input
            type="number"
            placeholder="не указано"
            value={pointsDraft}
            onChange={(e) => setPointsDraft(e.target.value)}
          />
        </label>
        {hasParticipantPoints && (
          <label className="points-inline-label">
            Баллы участникам (список состава)
            <input
              type="number"
              placeholder="не указано"
              value={participantPointsDraft}
              onChange={(e) => setParticipantPointsDraft(e.target.value)}
            />
          </label>
        )}
        <button type="button" onClick={handleSavePoints}>
          Сохранить баллы
        </button>
      </div>
      <p className="hint-text">
        {category.is_training
          ? "Начисляются автору (инструктору) при одобрении — за каждую выбранную специализацию отдельно (баллы × количество специализаций в рапорте)."
          : "Начисляются автоматически при одобрении рапорта этой категории, если баллы ещё не выставлены вручную." +
            (hasParticipantPoints ? " Баллы участникам получает каждый, кто указан в поле \"Список состава\"." : "")}
      </p>

      <div className="points-inline">
        <label className="points-inline-label">
          Мин. звание для подачи
          <select value={minRankDraft} onChange={(e) => setMinRankDraft(e.target.value)}>
            <option value="">не ограничено</option>
            {tiers.flatMap((tier) =>
              tier.ranks.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code} — {r.name}
                </option>
              ))
            )}
          </select>
        </label>
        <label className="points-inline-label">
          <input
            type="checkbox"
            checked={commanderOnlyDraft}
            onChange={(e) => setCommanderOnlyDraft(e.target.checked)}
          />
          Только заместитель+/командир
        </label>
        <label className="points-inline-label">
          Только со специализацией
          <select value={requiredSpecializationDraft} onChange={(e) => setRequiredSpecializationDraft(e.target.value)}>
            <option value="">не ограничено</option>
            {specializations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} — {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="points-inline-label">
          <input
            type="checkbox"
            checked={openToLeadershipDraft}
            onChange={(e) => setOpenToLeadershipDraft(e.target.checked)}
          />
          Открыто командирам/замам любых формирований
          <InfoHint text="Подать рапорт этой категории смогут не только бойцы этого формирования, но и командир/заместитель ЛЮБОГО другого формирования — например Штаб-категории «Боевая готовность»/«Защита ОВО», куда отчитываются командиры полков." />
        </label>
        {squads.length > 0 && (
          <label className="points-inline-label">
            Только участники отряда
            <select value={requiredSquadDraft} onChange={(e) => setRequiredSquadDraft(e.target.value)}>
              <option value="">не ограничено</option>
              {squads.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <InfoHint text="Категория будет видна в общей форме подачи рапорта только участникам этого отряда (любого уровня) — например «Рапорт о разведке» для отряда «Разведка»." />
          </label>
        )}
        <button type="button" onClick={handleSaveRestrictions}>
          Сохранить ограничения
        </button>
      </div>
      <p className="hint-text">
        Ограничивает, кто может подать рапорт этой категории (например, "обучение на Ряд может проводить только
        CPL+", "аттестации — только зам-КМД" или "Медицинский рапорт — только со специализацией «Медик»"). Не
        влияет на просмотр уже поданных рапортов.
      </p>

      {error && <p className="error-text">{error}</p>}
    </li>
  );
}

/** Настройка категорий рапортов и их полей — отдельная модалка для командира,
 * открывается кнопкой "Категории и поля" над списком рапортов. Поле категории может
 * быть обычным текстом или выплывающим списком состава (мульти-выбор бойцов). */
export function CategoryManagerModal({ regiments, onClose }) {
  const { token, regiments: allRegiments } = useAuth();
  const [regimentId, setRegimentId] = useState(regiments[0]?.id ?? "");
  const [categories, setCategories] = useState([]);
  const [tiers, setTiers] = useState([]);
  const [specializations, setSpecializations] = useState([]);
  const [squads, setSquads] = useState([]);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryFields, setNewCategoryFields] = useState([]);
  const [newCategoryPoints, setNewCategoryPoints] = useState("");
  const [newCategoryParticipantPoints, setNewCategoryParticipantPoints] = useState("");
  const [newCategoryRequiredSpecializationId, setNewCategoryRequiredSpecializationId] = useState("");
  const [newCategoryOpenToLeadership, setNewCategoryOpenToLeadership] = useState(false);
  const [newCategoryRequiredSquadId, setNewCategoryRequiredSquadId] = useState("");
  const [newFieldDraft, setNewFieldDraft] = useState("");
  const [newFieldDraftType, setNewFieldDraftType] = useState("text");
  const [newFieldDraftAllowedRegimentIds, setNewFieldDraftAllowedRegimentIds] = useState([]);
  const [newFieldDraftDefaultSelf, setNewFieldDraftDefaultSelf] = useState(false);
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

  useEffect(() => {
    api.getRanks(token).then(setTiers).catch(() => setTiers([]));
    api.listSpecializations(token).then(setSpecializations).catch(() => setSpecializations([]));
  }, [token]);

  useEffect(() => {
    if (!regimentId) return;
    api
      .listSquads(token, regimentId)
      .then(setSquads)
      .catch(() => setSquads([]));
  }, [token, regimentId]);

  function handleAddFieldDraft() {
    if (!newFieldDraft.trim()) return;
    const field = { name: newFieldDraft.trim(), type: newFieldDraftType };
    if (newFieldDraftType === "roster") {
      field.allowed_regiment_ids = newFieldDraftAllowedRegimentIds;
      field.default_self = newFieldDraftDefaultSelf;
    }
    setNewCategoryFields((prev) => [...prev, field]);
    setNewFieldDraft("");
    setNewFieldDraftType("text");
    setNewFieldDraftAllowedRegimentIds([]);
    setNewFieldDraftDefaultSelf(false);
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
        participantPoints: newCategoryParticipantPoints === "" ? null : Number(newCategoryParticipantPoints),
        requiredSpecializationId: newCategoryRequiredSpecializationId === "" ? null : Number(newCategoryRequiredSpecializationId),
        openToRegimentLeadership: newCategoryOpenToLeadership,
        requiredSquadId: newCategoryRequiredSquadId === "" ? null : Number(newCategoryRequiredSquadId),
      });
      setNewCategoryName("");
      setNewCategoryFields([]);
      setNewCategoryPoints("");
      setNewCategoryParticipantPoints("");
      setNewCategoryRequiredSpecializationId("");
      setNewCategoryOpenToLeadership(false);
      setNewCategoryRequiredSquadId("");
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

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal category-manager-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" aria-label="Закрыть" onClick={onClose}>
          ×
        </button>
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
          <InlineSpinner />
        ) : (
          <>
            <ul className="category-rows">
              {categories.map((c) => (
                <CategoryRow
                  key={c.id}
                  category={{ ...c, regiment_id: regimentId }}
                  tiers={tiers}
                  allRegiments={allRegiments}
                  specializations={specializations}
                  squads={squads}
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
                      {f.type === "roster" && f.default_self && <span className="hint-text"> (я сам)</span>}
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
              {newFieldDraftType === "roster" && (
                <>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={newFieldDraftDefaultSelf}
                      onChange={(e) => setNewFieldDraftDefaultSelf(e.target.checked)}
                    />
                    По умолчанию — я сам
                  </label>
                  <RosterAllowedRegiments
                    allRegiments={allRegiments}
                    currentRegimentId={regimentId}
                    selectedIds={newFieldDraftAllowedRegimentIds}
                    onChange={setNewFieldDraftAllowedRegimentIds}
                  />
                </>
              )}

              <label>
                Баллы за рапорт (необязательно)
                <input
                  type="number"
                  placeholder="не указано"
                  value={newCategoryPoints}
                  onChange={(e) => setNewCategoryPoints(e.target.value)}
                />
              </label>
              <label>
                Баллы участникам (список состава, необязательно)
                <input
                  type="number"
                  placeholder="не указано"
                  value={newCategoryParticipantPoints}
                  onChange={(e) => setNewCategoryParticipantPoints(e.target.value)}
                />
              </label>
              <label>
                Только со специализацией (необязательно)
                <select
                  value={newCategoryRequiredSpecializationId}
                  onChange={(e) => setNewCategoryRequiredSpecializationId(e.target.value)}
                >
                  <option value="">не ограничено</option>
                  {specializations.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code} — {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={newCategoryOpenToLeadership}
                  onChange={(e) => setNewCategoryOpenToLeadership(e.target.checked)}
                />
                {" "}Открыто командирам/замам любых формирований
                <InfoHint text="Подать рапорт этой категории смогут не только бойцы этого формирования, но и командир/заместитель ЛЮБОГО другого формирования." />
              </label>
              {squads.length > 0 && (
                <label>
                  Только участники отряда (необязательно)
                  <select
                    value={newCategoryRequiredSquadId}
                    onChange={(e) => setNewCategoryRequiredSquadId(e.target.value)}
                  >
                    <option value="">не ограничено</option>
                    {squads.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

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
    </div>,
    document.body
  );
}
