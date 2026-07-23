import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

export function SettingsPage() {
  const { token } = useAuth();
  const [roles, setRoles] = useState([]);
  const [adminRoleId, setAdminRoleId] = useState("");
  const [commanderRoleId, setCommanderRoleId] = useState("");
  const [deputyRoleId, setDeputyRoleId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    async function init() {
      try {
        const [rolesData, current] = await Promise.all([
          api.getDiscordRoles(token),
          api.getAppSettings(token),
        ]);
        setRoles(rolesData);
        setAdminRoleId(current.admin_role_id || "");
        setCommanderRoleId(current.commander_role_id || "");
        setDeputyRoleId(current.deputy_role_id || "");
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [token]);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      // Пустая строка ("не выбрано") — валидное значение, означающее "очистить роль";
      // не подменяем на null, иначе бэкенд решит, что поле вообще не передано
      await api.updateAppSettings(token, { adminRoleId, commanderRoleId, deputyRoleId });
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
