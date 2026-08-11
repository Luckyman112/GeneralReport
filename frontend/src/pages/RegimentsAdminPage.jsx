import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { PageLoading } from "../components/PageLoading";
import { RegimentConfigModal } from "../components/RegimentConfigModal";

export function RegimentsAdminPage() {
  const { token } = useAuth();
  const [regiments, setRegiments] = useState([]);
  const [roles, setRoles] = useState([]);
  const [tiers, setTiers] = useState([]);
  const [editingRegiment, setEditingRegiment] = useState(null);
  const [newName, setNewName] = useState("");
  const [newRoleId, setNewRoleId] = useState("");
  const [newColor, setNewColor] = useState("#5865f2");
  const [newIsJediOrder, setNewIsJediOrder] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [archivingId, setArchivingId] = useState(null);
  const [confirmArchiveRegiment, setConfirmArchiveRegiment] = useState(null);

  const loadAll = useCallback(async () => {
    const [regimentsData, rolesData, tiersData] = await Promise.all([
      api.listRegiments(token, { includeArchived: true }),
      api.getDiscordRoles(token),
      api.getRanks(token),
    ]);
    setRegiments(regimentsData);
    setRoles(rolesData);
    setTiers(tiersData);
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
      await api.createRegiment(token, {
        name: newName.trim(),
        discordRoleId: newRoleId,
        color: newColor,
        isJediOrder: newIsJediOrder,
      });
      setNewName("");
      setNewIsJediOrder(false);
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  async function handleToggleArchive(regiment) {
    setConfirmArchiveRegiment(null);
    setArchivingId(regiment.id);
    setError(null);
    try {
      await api.archiveRegiment(token, regiment.id, !regiment.is_archived);
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setArchivingId(null);
    }
  }

  if (loading) return <PageLoading />;

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
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={newIsJediOrder}
            onChange={(e) => setNewIsJediOrder(e.target.checked)}
          />
          Орден джедаев (основному профилю бойцов можно назначать только джедайские звания)
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
          <div key={r.id} className={`regiment-card${r.is_archived ? " regiment-card-archived" : ""}`}>
            <span className="regiment-card-name">
              <span className="color-swatch" style={{ background: r.color || "var(--surface-2)" }} />
              <strong>{r.name}</strong>
              {r.is_archived && <span className="member-inactive-badge">заморожено</span>}
            </span>
            <button onClick={() => setEditingRegiment(r)}>Настроить</button>
            <button
              className="ghost"
              disabled={archivingId === r.id}
              onClick={() => (r.is_archived ? handleToggleArchive(r) : setConfirmArchiveRegiment(r))}
            >
              {r.is_archived ? "Разморозить" : "Заморозить"}
            </button>
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={confirmArchiveRegiment !== null}
        message={`Заморозить формирование «${confirmArchiveRegiment?.name}»? Категории/звания/история останутся, но формирование станет неактивным для новых действий.`}
        confirmLabel="Заморозить"
        onConfirm={() => handleToggleArchive(confirmArchiveRegiment)}
        onCancel={() => setConfirmArchiveRegiment(null)}
      />

      {editingRegiment && (
        <RegimentConfigModal
          regiment={editingRegiment}
          roles={roles}
          tiers={tiers}
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
