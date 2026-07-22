import { useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

export function RegimentConfigModal({ regiment, roles, onClose, onSaved }) {
  const { token } = useAuth();
  const [name, setName] = useState(regiment.name);
  const [discordRoleId, setDiscordRoleId] = useState(regiment.discord_role_id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await api.updateRegiment(token, regiment.id, { name, discordRoleId });
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Настройка формирования</h3>

        <label>
          Название
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>

        <label>
          Роль формирования
          <select value={discordRoleId} onChange={(e) => setDiscordRoleId(e.target.value)}>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>

        {error && <p className="error-text">{error}</p>}

        <div className="modal-actions">
          <button className="primary" disabled={saving} onClick={handleSave}>
            Сохранить
          </button>
          <button className="ghost" onClick={onClose}>
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
}
