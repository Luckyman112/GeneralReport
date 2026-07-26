import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { MemberSearchPicker } from "../components/MemberSearchPicker";

export function SettingsPage() {
  const { token } = useAuth();
  const [roles, setRoles] = useState([]);
  const [members, setMembers] = useState([]);
  const [adminRoleId, setAdminRoleId] = useState("");
  const [commanderRoleId, setCommanderRoleId] = useState("");
  const [deputyRoleId, setDeputyRoleId] = useState("");
  const [highCommandRoleId, setHighCommandRoleId] = useState("");
  const [founderRoleId, setFounderRoleId] = useState("");
  const [adminUserDiscordIds, setAdminUserDiscordIds] = useState([]);
  const [addAdminId, setAddAdminId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  const membersById = Object.fromEntries(members.map((m) => [m.discord_id, m]));

  useEffect(() => {
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
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [token]);

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
      });
      setSaved(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="page-loading">Загрузка...</div>;

  return (
    <div className="settings-page">
      <h2>Настройки ролей</h2>
      <p className="hint-text">
        Доступно только при входе по паролю. Обычные Discord-администраторы эту страницу не видят.
      </p>

      <form className="report-form" onSubmit={handleSave}>
        <label>
          Роль администратора
          <select value={adminRoleId} onChange={(e) => setAdminRoleId(e.target.value)}>
            <option value="">— не выбрано —</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
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

        <label>
          Роль основателя (полные права администратора, для аудита действий)
          <select value={founderRoleId} onChange={(e) => setFounderRoleId(e.target.value)}>
            <option value="">— не выбрано —</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Роль командира
          <select value={commanderRoleId} onChange={(e) => setCommanderRoleId(e.target.value)}>
            <option value="">— не выбрано —</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Роль заместителя
          <select value={deputyRoleId} onChange={(e) => setDeputyRoleId(e.target.value)}>
            <option value="">— не выбрано —</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Роль высшего командования
          <select value={highCommandRoleId} onChange={(e) => setHighCommandRoleId(e.target.value)}>
            <option value="">— не выбрано —</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <p className="hint-text">
          Как командир/заместитель, но сразу для всех формирований — управляет категориями, выдаёт выговоры
          вплоть до командиров.
        </p>

        {error && <p className="error-text">{error}</p>}
        {saved && <p className="hint-text">Сохранено.</p>}

        <div className="report-form-actions">
          <button className="primary" type="submit" disabled={saving}>
            Сохранить
          </button>
        </div>
      </form>
    </div>
  );
}
