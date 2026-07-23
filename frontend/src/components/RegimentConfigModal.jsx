import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

export function RegimentConfigModal({ regiment, roles, onClose, onSaved }) {
  const { token } = useAuth();
  const [name, setName] = useState(regiment.name);
  const [discordRoleId, setDiscordRoleId] = useState(regiment.discord_role_id);
  const [color, setColor] = useState(regiment.color || "#5865f2");
  const [commanders, setCommanders] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [selectedCandidate, setSelectedCandidate] = useState("");
  const [selectedRoleType, setSelectedRoleType] = useState("commander");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const availableCandidates = useMemo(
    () => candidates.filter((c) => !commanders.some((cmd) => cmd.discord_id === c.discord_id)),
    [candidates, commanders]
  );

  async function loadCommanders() {
    try {
      const [commandersData, candidatesData] = await Promise.all([
        api.listCommanders(token, regiment.id),
        api.getCommanderCandidates(token, regiment.id),
      ]);
      setCommanders(commandersData);
      setCandidates(candidatesData);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    loadCommanders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await api.updateRegiment(token, regiment.id, { name, discordRoleId, color });
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleAddCommander() {
    const candidate = availableCandidates.find((c) => c.discord_id === selectedCandidate);
    if (!candidate) return;
    try {
      await api.addCommander(token, regiment.id, {
        discordId: candidate.discord_id,
        username: candidate.username,
        roleType: selectedRoleType,
      });
      setSelectedCandidate("");
      await loadCommanders();
    } catch (e) {
      setError(e.message);
    }
  }

  function handleSelectCandidate(discordId) {
    setSelectedCandidate(discordId);
    const candidate = candidates.find((c) => c.discord_id === discordId);
    if (candidate) {
      setSelectedRoleType(candidate.is_commander_role ? "commander" : "deputy");
    }
  }

  async function handleRemoveCommander(discordId) {
    try {
      await api.removeCommander(token, regiment.id, discordId);
      await loadCommanders();
    } catch (e) {
      setError(e.message);
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

        <label className="color-picker-label">
          Цвет формирования
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
        </label>

        <h4>Командиры</h4>
        <p className="hint-text">
          Только эти люди получат командирские права над формированием (даже если у них есть
          общая роль «Командир» и роль этого формирования).
        </p>
        <ul className="category-list">
          {commanders.map((c) => (
            <li key={c.discord_id}>
              {c.username} <span className="hint-text">({c.role_type === "deputy" ? "заместитель" : "командир"})</span>
              <button className="ghost" onClick={() => handleRemoveCommander(c.discord_id)}>
                Снять
              </button>
            </li>
          ))}
        </ul>

        {availableCandidates.length > 0 && (
          <div className="add-category-form">
            <select value={selectedCandidate} onChange={(e) => handleSelectCandidate(e.target.value)}>
              <option value="">— выбрать участника —</option>
              {availableCandidates.map((c) => (
                <option key={c.discord_id} value={c.discord_id}>
                  {c.username}
                </option>
              ))}
            </select>
            <select value={selectedRoleType} onChange={(e) => setSelectedRoleType(e.target.value)}>
              <option value="commander">Командир</option>
              <option value="deputy">Заместитель</option>
            </select>
            <button type="button" disabled={!selectedCandidate} onClick={handleAddCommander}>
              Назначить
            </button>
          </div>
        )}

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
