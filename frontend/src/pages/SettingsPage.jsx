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
  const [access, setAccess] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    Promise.all([api.getDiscordRoles(token), api.getModuleAccess(token)]).then(([rolesData, accessData]) => {
      setRoles(rolesData);
      setAccess(accessData);
    });
  }, [token]);

  function toggleRegiment(field, id) {
    setAccess((prev) => ({
      ...prev,
      [field]: prev[field].includes(id) ? prev[field].filter((x) => x !== id) : [...prev[field], id],
    }));
  }

  function setRoleField(field, ids) {
    setAccess((prev) => ({ ...prev, [field]: ids }));
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

export function SettingsPage() {
  const { token, access } = useAuth();
  const [roles, setRoles] = useState([]);
  const [members, setMembers] = useState([]);
  const [adminRoleId, setAdminRoleId] = useState("");
  const [commanderRoleId, setCommanderRoleId] = useState("");
  const [deputyRoleId, setDeputyRoleId] = useState("");
  const [highCommandRoleId, setHighCommandRoleId] = useState("");
  const [founderRoleId, setFounderRoleId] = useState("");
  const [instructorRoleId, setInstructorRoleId] = useState("");
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
        setInstructorRoleId(current.instructor_role_id || "");
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
        instructorRoleId,
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
              <h4>Инструктор</h4>
              <p className="hint-text">Может выдавать и снимать специализации бойцам в их личном деле.</p>
              <label>
                Discord-роль
                <RoleSelect value={instructorRoleId} onChange={setInstructorRoleId} />
              </label>
            </div>

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
    </div>
  );
}
