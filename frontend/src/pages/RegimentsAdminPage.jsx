import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { RegimentConfigModal } from "../components/RegimentConfigModal";

export function RegimentsAdminPage() {
  const { token } = useAuth();
  const [regiments, setRegiments] = useState([]);
  const [roles, setRoles] = useState([]);
  const [editingRegiment, setEditingRegiment] = useState(null);
  const [newName, setNewName] = useState("");
  const [newRoleId, setNewRoleId] = useState("");
  const [newColor, setNewColor] = useState("#5865f2");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    const [regimentsData, rolesData] = await Promise.all([
      api.listRegiments(token),
      api.getDiscordRoles(token),
    ]);
    setRegiments(regimentsData);
    setRoles(rolesData);
    setNewRoleId((current) => current || rolesData[0]?.id || "");
  }, [token]);

  useEffect(() => {
    loadAll()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [loadAll]);

  async function handleCreate(e) {
    e.preventDefault();
    if (!newName.trim() || !newRoleId) return;
    setCreating(true);
    setError(null);
    try {
      await api.createRegiment(token, { name: newName.trim(), discordRoleId: newRoleId, color: newColor });
      setNewName("");
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  if (loading) return <div className="page-loading">Загрузка...</div>;

  return (
    <div className="regiments-admin-page">
      <form className="report-form" onSubmit={handleCreate}>
        <h3>Новое формирование</h3>
        <label>
          Название
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Например, 501-й" />
        </label>
        <label>
          Роль формирования (Discord)
          <select value={newRoleId} onChange={(e) => setNewRoleId(e.target.value)}>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="color-picker-label">
          Цвет формирования
          <input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)} />
        </label>
        <div className="report-form-actions">
          <button className="primary" disabled={creating} type="submit">
            Создать
          </button>
        </div>
      </form>

      {error && <p className="error-text">{error}</p>}

      <div className="regiment-list">
        {regiments.map((r) => (
          <div key={r.id} className="regiment-card">
            <span className="regiment-card-name">
              <span className="color-swatch" style={{ background: r.color || "var(--surface-2)" }} />
              <strong>{r.name}</strong>
            </span>
            <button onClick={() => setEditingRegiment(r)}>Настроить</button>
          </div>
        ))}
      </div>

      {editingRegiment && (
        <RegimentConfigModal
          regiment={editingRegiment}
          roles={roles}
          onClose={() => setEditingRegiment(null)}
          onSaved={() => {
            setEditingRegiment(null);
            loadAll();
          }}
        />
      )}
    </div>
  );
}
