import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { InlineSpinner } from "../components/InlineSpinner";
import { MemberSearchPicker } from "../components/MemberSearchPicker";
import { MultiSelectDropdown } from "../components/MultiSelectDropdown";
import { PageLoading } from "../components/PageLoading";
import { InfoHint } from "../components/Tooltip";

// dropdown multi-select instead of checkboxes, server can have many roles
function ModuleAccessSettings() {
  const { token, regiments } = useAuth();
  const [roles, setRoles] = useState([]);
  const [channels, setChannels] = useState([]);
  const [members, setMembers] = useState([]);
  const [access, setAccess] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [addRejectId, setAddRejectId] = useState("");

  useEffect(() => {
    Promise.all([
      api.getDiscordRoles(token),
      api.getModuleAccess(token),
      api.getDiscordChannels(token),
      api.getViewAsCandidates(token),
    ]).then(([rolesData, accessData, channelsData, membersData]) => {
      setRoles(rolesData);
      setAccess(accessData);
      setChannels(channelsData);
      setMembers(membersData);
    });
  }, [token]);

  const membersById = Object.fromEntries(members.map((m) => [m.discord_id, m]));

  function toggleRegiment(field, id) {
    setAccess((prev) => ({
      ...prev,
      [field]: prev[field].includes(id) ? prev[field].filter((x) => x !== id) : [...prev[field], id],
    }));
  }

  function setRoleField(field, ids) {
    setAccess((prev) => ({ ...prev, [field]: ids }));
  }

  function setSingleField(field, value) {
    setAccess((prev) => ({ ...prev, [field]: value }));
  }

  function handleAddReject() {
    if (!addRejectId || access.report_reject_user_discord_ids.includes(addRejectId)) return;
    setAccess((prev) => ({
      ...prev,
      report_reject_user_discord_ids: [...prev.report_reject_user_discord_ids, addRejectId],
    }));
    setAddRejectId("");
  }

  function handleRemoveReject(discordId) {
    setAccess((prev) => ({
      ...prev,
      report_reject_user_discord_ids: prev.report_reject_user_discord_ids.filter((id) => id !== discordId),
    }));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.updateModuleAccess(token, access);
      setSaved(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (!access) return <InlineSpinner />;

  return (
    <div className="regiment-panel fade-in-up">
      <h4>Настройки модуля (администратор)</h4>

      <label>
        Кто может заводить нарушения — по формированию:
        <InfoHint text="Кто может заводить записи о нарушениях (рапорт о задержании)." />
      </label>
      <div className="field-tags">
        {regiments.map((r) => (
          <label key={r.id} className="checkbox-label field-tag">
            <input
              type="checkbox"
              checked={access.violation_writer_regiment_ids.includes(r.id)}
              onChange={() => toggleRegiment("violation_writer_regiment_ids", r.id)}
            />
            {r.name}
          </label>
        ))}
      </div>
      <label>
        ...или по Discord-роли:
        <MultiSelectDropdown
          items={roles}
          selectedIds={access.violation_writer_role_ids}
          onChange={(ids) => setRoleField("violation_writer_role_ids", ids)}
        />
      </label>

      <label>
        Кто может видеть весь список нарушений — по формированию:
        <InfoHint text="Помимо этого списка, всегда видят командиры/заместители своего формирования." />
      </label>
      <div className="field-tags">
        {regiments.map((r) => (
          <label key={r.id} className="checkbox-label field-tag">
            <input
              type="checkbox"
              checked={access.violation_viewer_regiment_ids.includes(r.id)}
              onChange={() => toggleRegiment("violation_viewer_regiment_ids", r.id)}
            />
            {r.name}
          </label>
        ))}
      </div>
      <label>
        ...или по Discord-роли:
        <MultiSelectDropdown
          items={roles}
          selectedIds={access.violation_viewer_role_ids}
          onChange={(ids) => setRoleField("violation_viewer_role_ids", ids)}
        />
      </label>

      <label>
        Кто может отправлять объявления всем (кнопка рассылки в шапке) — по Discord-роли:
        <MultiSelectDropdown
          items={roles}
          selectedIds={access.broadcast_role_ids}
          onChange={(ids) => setRoleField("broadcast_role_ids", ids)}
        />
      </label>

      <label>
        Кому в разделе "Рапорты" видна кнопка "Рапорт о задержании" — по Discord-роли:
        <MultiSelectDropdown
          items={roles}
          selectedIds={access.detention_report_role_ids}
          onChange={(ids) => setRoleField("detention_report_role_ids", ids)}
        />
      </label>

      <label>
        Кто может ПРОСМАТРИВАТЬ рапорты об обучении в "Инструкторской" (помимо инструкторов/высшего
        командования/администратора, которым доступ всегда есть) — по Discord-роли:
        <MultiSelectDropdown
          items={roles}
          selectedIds={access.training_viewer_role_ids}
          onChange={(ids) => setRoleField("training_viewer_role_ids", ids)}
        />
      </label>

      <label>
        Формирования-источники кандидатов в наставники:
        <InfoHint text="Чьи участники считаются кандидатами в наставники ДРУГИХ формирований (например, БСО/Наёмники); джедаи — кандидаты автоматически, независимо от этого списка." />
      </label>
      <div className="field-tags">
        {regiments.map((r) => (
          <label key={r.id} className="checkbox-label field-tag">
            <input
              type="checkbox"
              checked={access.mentor_source_regiment_ids.includes(r.id)}
              onChange={() => toggleRegiment("mentor_source_regiment_ids", r.id)}
            />
            {r.name}
          </label>
        ))}
      </div>

      <label>
        Кто может обжаловать решение по рапорту — по формированию:
        <InfoHint text="Отменить уже принятое решение по любому рапорту (одобрение/отклонение/удаление) — в дополнение к командиру/заместителю/наставнику формирования, которым это уже доступно." />
      </label>
      <div className="field-tags">
        {regiments.map((r) => (
          <label key={r.id} className="checkbox-label field-tag">
            <input
              type="checkbox"
              checked={access.report_appeal_regiment_ids.includes(r.id)}
              onChange={() => toggleRegiment("report_appeal_regiment_ids", r.id)}
            />
            {r.name}
          </label>
        ))}
      </div>
      <label>
        ...или по Discord-роли:
        <MultiSelectDropdown
          items={roles}
          selectedIds={access.report_appeal_role_ids}
          onChange={(ids) => setRoleField("report_appeal_role_ids", ids)}
        />
      </label>

      <label>
        Кто может ОТКЛОНЯТЬ любой рапорт — по Discord-роли:
        <InfoHint text="Отдельная привилегия, не связанная с командованием формированием — например, куратор специализации, который должен уметь отклонить рапорт об обучении в любом формировании." />
        <MultiSelectDropdown
          items={roles}
          selectedIds={access.report_reject_role_ids}
          onChange={(ids) => setRoleField("report_reject_role_ids", ids)}
        />
      </label>
      <label>
        ...или конкретные люди:
        <span className="picker-row">
          <MemberSearchPicker members={members} selectedId={addRejectId} onSelect={setAddRejectId} />
          <button type="button" onClick={handleAddReject} disabled={!addRejectId}>
            Добавить
          </button>
        </span>
      </label>
      {access.report_reject_user_discord_ids.length > 0 && (
        <ul className="chip-list">
          {access.report_reject_user_discord_ids.map((discordId) => (
            <li key={discordId} className="chip">
              {membersById[discordId]?.username || discordId}
              <button type="button" onClick={() => handleRemoveReject(discordId)}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <h4>Ивентрум</h4>
      <p className="hint-text">
        Независимая от инструкторской ролевая система: Ивентолог подаёт заявку на ивент, Ассистент/Куратор
        ивентологии одобряют — при одобрении бот отправляет сообщение в выбранный канал.
      </p>
      <label>
        Discord-роль «Ивентолог» (подаёт заявки):
        <select value={access.event_role_id || ""} onChange={(e) => setSingleField("event_role_id", e.target.value)}>
          <option value="">— не выбрано —</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Discord-роль «Ассистент ивентологии» (одобряет):
        <select
          value={access.event_assistant_role_id || ""}
          onChange={(e) => setSingleField("event_assistant_role_id", e.target.value)}
        >
          <option value="">— не выбрано —</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Discord-роль «Куратор ивентологии» (одобряет):
        <select
          value={access.event_curator_role_id || ""}
          onChange={(e) => setSingleField("event_curator_role_id", e.target.value)}
        >
          <option value="">— не выбрано —</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Канал уведомлений об одобренных ивентах:
        <select
          value={access.event_notify_channel_id || ""}
          onChange={(e) => setSingleField("event_notify_channel_id", e.target.value)}
        >
          <option value="">— не выбрано —</option>
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              #{c.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Роль для пинга в сообщении об одобренном ивенте:
        <InfoHint text="Необязательно. Если выбрана, бот упомянет эту роль в тексте сообщения — вместе с прикреплённой картинкой-досье." />
        <select
          value={access.event_notify_ping_role_id || ""}
          onChange={(e) => setSingleField("event_notify_ping_role_id", e.target.value)}
        >
          <option value="">— не выбрано —</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>

      <div className="report-form-actions">
        <button className="primary" onClick={handleSave} disabled={saving}>
          Сохранить настройки доступа
        </button>
      </div>

      {error && <p className="error-text">{error}</p>}
      {saved && <p className="hint-text">Сохранено.</p>}
    </div>
  );
}

const INSTRUCTOR_DISCIPLINE_LABELS = {
  medic: "Медицина",
  pilot: "Пилотирование",
  engineer: "Инженерия",
};

// instructor — рядовой (учит своей дисциплине или всему), deputy — DEP (плюс
// каталог/бан/категории/ростер своей ветки), curator — CU (один на ветку,
// плюс кросс-формационный обзор) — см. app/models/specialization.py::INSTRUCTOR_TIERS
const INSTRUCTOR_TIER_LABELS = {
  instructor: "Инструктор",
  deputy: "Заместитель (DEP)",
  curator: "Куратор (CU)",
};

// Discord-роль -> какие специализации разрешено выдавать: конкретная дисциплина
// (медик/пилот/инженер, видит только свои подспециализации) или "учит всему"
// (напр. роль "ARC | INS") — в отличие от старой единой роли "Инструктор",
// можно завести сколько угодно ролей с разными правами
function InstructorRolesSettings() {
  const { token } = useAuth();
  const [roles, setRoles] = useState([]);
  const [instructorRoles, setInstructorRoles] = useState([]);
  const [newRoleId, setNewRoleId] = useState("");
  const [newDiscipline, setNewDiscipline] = useState("medic");
  const [newCanTeachAll, setNewCanTeachAll] = useState(false);
  const [newTier, setNewTier] = useState("instructor");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([api.getDiscordRoles(token), api.listInstructorRoles(token)])
      .then(([rolesData, instructorRolesData]) => {
        setRoles(rolesData);
        setInstructorRoles(instructorRolesData);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  const rolesById = Object.fromEntries(roles.map((r) => [r.id, r]));
  const configuredRoleIds = new Set(instructorRoles.map((r) => r.discord_role_id));
  const availableRoles = roles.filter((r) => !configuredRoleIds.has(r.id));

  async function handleAdd() {
    if (!newRoleId) return;
    setSaving(true);
    setError(null);
    try {
      const created = await api.createInstructorRole(token, {
        discordRoleId: newRoleId,
        label: rolesById[newRoleId]?.name || newRoleId,
        discipline: newCanTeachAll ? null : newDiscipline,
        canTeachAll: newCanTeachAll,
        tier: newCanTeachAll ? "instructor" : newTier,
      });
      setInstructorRoles((prev) => [...prev, created]);
      setNewRoleId("");
      setNewTier("instructor");
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    setSaving(true);
    setError(null);
    try {
      await api.deleteInstructorRole(token, id);
      setInstructorRoles((prev) => prev.filter((r) => r.id !== id));
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <InlineSpinner />;

  return (
    <div className="regiment-panel fade-in-up">
      <h4>Инструкторы и дисциплины</h4>
      <p className="hint-text">
        Каждая Discord-роль разрешает выдавать либо конкретную дисциплину (боец увидит в Инструкторской только
        её подспециализации), либо вообще всё — для роли-универсала вроде «ARC | INS». Обычные (не дисциплинарные)
        категории специализаций доступны любому инструктору из списка ниже.
      </p>

      {instructorRoles.length > 0 && (
        <ul className="chip-list">
          {instructorRoles.map((r) => (
            <li key={r.id} className="chip">
              {r.label} — {r.can_teach_all ? "учит всему" : INSTRUCTOR_DISCIPLINE_LABELS[r.discipline] || r.discipline}
              {r.tier !== "instructor" && ` (${INSTRUCTOR_TIER_LABELS[r.tier] || r.tier})`}
              <button type="button" onClick={() => handleDelete(r.id)} disabled={saving}>
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="picker-row">
        <select value={newRoleId} onChange={(e) => setNewRoleId(e.target.value)}>
          <option value="">— выбрать Discord-роль —</option>
          {availableRoles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>

        <select
          value={newCanTeachAll ? "all" : newDiscipline}
          onChange={(e) => {
            if (e.target.value === "all") {
              setNewCanTeachAll(true);
            } else {
              setNewCanTeachAll(false);
              setNewDiscipline(e.target.value);
            }
          }}
        >
          {Object.entries(INSTRUCTOR_DISCIPLINE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
          <option value="all">Учит всему</option>
        </select>

        <select value={newTier} onChange={(e) => setNewTier(e.target.value)} disabled={newCanTeachAll} title="Уровень">
          {Object.entries(INSTRUCTOR_TIER_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <button type="button" onClick={handleAdd} disabled={!newRoleId || saving}>
          Добавить
        </button>
      </div>

      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

export function SettingsPage() {
  const { token, access } = useAuth();
  const [roles, setRoles] = useState([]);
  const [members, setMembers] = useState([]);
  const [adminRoleId, setAdminRoleId] = useState("");
  const [commanderRoleId, setCommanderRoleId] = useState("");
  const [deputyRoleId, setDeputyRoleId] = useState("");
  const [highCommandRoleId, setHighCommandRoleId] = useState("");
  const [founderRoleId, setFounderRoleId] = useState("");
  const [founderUserDiscordIds, setFounderUserDiscordIds] = useState([]);
  const [addFounderId, setAddFounderId] = useState("");
  const [adminUserDiscordIds, setAdminUserDiscordIds] = useState([]);
  const [addAdminId, setAddAdminId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  const membersById = Object.fromEntries(members.map((m) => [m.discord_id, m]));
  const isPasswordLogin = Boolean(access?.is_password_login);

  useEffect(() => {
    // role assignment is password-login only, skip loading to avoid 403s otherwise
    if (!isPasswordLogin) {
      setLoading(false);
      return;
    }
    async function init() {
      try {
        const [rolesData, current, membersData] = await Promise.all([
          api.getDiscordRoles(token),
          api.getAppSettings(token),
          api.getAppSettingsMembers(token),
        ]);
        setRoles(rolesData);
        setMembers(membersData);
        setAdminRoleId(current.admin_role_id || "");
        setCommanderRoleId(current.commander_role_id || "");
        setDeputyRoleId(current.deputy_role_id || "");
        setHighCommandRoleId(current.high_command_role_id || "");
        setAdminUserDiscordIds(current.admin_user_discord_ids || []);
        setFounderRoleId(current.founder_role_id || "");
        setFounderUserDiscordIds(current.founder_user_discord_ids || []);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [token, isPasswordLogin]);

  function handleAddAdmin() {
    if (!addAdminId || adminUserDiscordIds.includes(addAdminId)) return;
    setAdminUserDiscordIds((prev) => [...prev, addAdminId]);
    setAddAdminId("");
  }

  function handleRemoveAdmin(discordId) {
    setAdminUserDiscordIds((prev) => prev.filter((id) => id !== discordId));
  }

  function handleAddFounder() {
    if (!addFounderId || founderUserDiscordIds.includes(addFounderId)) return;
    setFounderUserDiscordIds((prev) => [...prev, addFounderId]);
    setAddFounderId("");
  }

  function handleRemoveFounder(discordId) {
    setFounderUserDiscordIds((prev) => prev.filter((id) => id !== discordId));
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      // Пустая строка ("не выбрано") — валидное значение, означающее "очистить роль";
      // не подменяем на null, иначе бэкенд решит, что поле вообще не передано
      await api.updateAppSettings(token, {
        adminRoleId,
        commanderRoleId,
        deputyRoleId,
        highCommandRoleId,
        adminUserDiscordIds,
        founderRoleId,
        founderUserDiscordIds,
      });
      setSaved(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <PageLoading />;

  function RoleSelect({ value, onChange }) {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— не выбрано —</option>
        {roles.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
    );
  }

  return (
    <div className="settings-page">
      <h2>Настройки</h2>

      {isPasswordLogin && (
        <>
          <h3>Настройки ролей</h3>
          <p className="hint-text">
            Доступно только при входе по паролю. Обычные Discord-администраторы этот блок не видят.
          </p>

          <form className="settings-role-list" onSubmit={handleSave}>
            {/* От меньшего уровня доступа к большему — так порядок полей совпадает с
                иерархией прав, а не расположен вразнобой */}
            <div className="regiment-panel fade-in-up settings-role-card">
              <h4>Заместитель</h4>
              <label>
                Discord-роль
                <RoleSelect value={deputyRoleId} onChange={setDeputyRoleId} />
              </label>
            </div>

            <div className="regiment-panel fade-in-up settings-role-card">
              <h4>Командир</h4>
              <label>
                Discord-роль
                <RoleSelect value={commanderRoleId} onChange={setCommanderRoleId} />
              </label>
            </div>

            <div className="regiment-panel fade-in-up settings-role-card">
              <h4>Высшее командование</h4>
              <p className="hint-text">
                Как командир/заместитель, но сразу для всех формирований — управляет категориями, выдаёт выговоры
                вплоть до командиров.
              </p>
              <label>
                Discord-роль
                <RoleSelect value={highCommandRoleId} onChange={setHighCommandRoleId} />
              </label>
            </div>

            <div className="regiment-panel fade-in-up settings-role-card">
              <h4>Администратор</h4>
              <label>
                Discord-роль
                <RoleSelect value={adminRoleId} onChange={setAdminRoleId} />
              </label>

              <label>
                Отдельные администраторы (в дополнение к роли)
                <span className="picker-row">
                  <MemberSearchPicker members={members} selectedId={addAdminId} onSelect={setAddAdminId} />
                  <button type="button" onClick={handleAddAdmin} disabled={!addAdminId}>
                    Добавить
                  </button>
                </span>
              </label>
              {adminUserDiscordIds.length > 0 && (
                <ul className="chip-list">
                  {adminUserDiscordIds.map((discordId) => (
                    <li key={discordId} className="chip">
                      {membersById[discordId]?.username || discordId}
                      <button type="button" onClick={() => handleRemoveAdmin(discordId)}>
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="regiment-panel fade-in-up settings-role-card">
              <h4>Основатель</h4>
              <p className="hint-text">
                Полные права администратора — заходит под своим Discord-аккаунтом, для аудита действий.
              </p>
              <label>
                Discord-роль
                <RoleSelect value={founderRoleId} onChange={setFounderRoleId} />
              </label>

              <label>
                Отдельные основатели (в дополнение к роли)
                <span className="picker-row">
                  <MemberSearchPicker members={members} selectedId={addFounderId} onSelect={setAddFounderId} />
                  <button type="button" onClick={handleAddFounder} disabled={!addFounderId}>
                    Добавить
                  </button>
                </span>
              </label>
              {founderUserDiscordIds.length > 0 && (
                <ul className="chip-list">
                  {founderUserDiscordIds.map((discordId) => (
                    <li key={discordId} className="chip">
                      {membersById[discordId]?.username || discordId}
                      <button type="button" onClick={() => handleRemoveFounder(discordId)}>
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {error && <p className="error-text">{error}</p>}
            {saved && <p className="hint-text">Сохранено.</p>}

            <div className="report-form-actions">
              <button className="primary" type="submit" disabled={saving}>
                Сохранить
              </button>
            </div>
          </form>
        </>
      )}

      {access?.is_admin && <ModuleAccessSettings />}
      {access?.is_admin && <InstructorRolesSettings />}
    </div>
  );
}
