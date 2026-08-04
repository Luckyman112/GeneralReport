import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { InfoHint } from "./Tooltip";

export function RegimentConfigModal({ regiment, roles, tiers, onClose, onSaved }) {
  const { token } = useAuth();
  const [name, setName] = useState(regiment.name);
  const [discordRoleId, setDiscordRoleId] = useState(regiment.discord_role_id);
  const [color, setColor] = useState(regiment.color || "#5865f2");
  const [discordChannelUrl, setDiscordChannelUrl] = useState(regiment.discord_channel_url || "");
  const [isJediOrder, setIsJediOrder] = useState(regiment.is_jedi_order || false);
  const [startingRankId, setStartingRankId] = useState(regiment.starting_rank_id || "");
  const [commanders, setCommanders] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [mentorCandidates, setMentorCandidates] = useState([]);
  const [selectedCandidate, setSelectedCandidate] = useState("");
  const [selectedRoleType, setSelectedRoleType] = useState("commander");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const availableCandidates = useMemo(() => {
    const source = selectedRoleType === "mentor" ? mentorCandidates : candidates;
    return source.filter((c) => !commanders.some((cmd) => cmd.discord_id === c.discord_id));
  }, [candidates, mentorCandidates, commanders, selectedRoleType]);

  const availableRanks = useMemo(
    () =>
      (tiers || [])
        .filter((t) => Boolean(t.is_jedi) === isJediOrder)
        .flatMap((t) => t.ranks),
    [tiers, isJediOrder]
  );

  async function loadCommanders() {
    try {
      const [commandersData, candidatesData, mentorCandidatesData] = await Promise.all([
        api.listCommanders(token, regiment.id),
        api.getCommanderCandidates(token, regiment.id),
        api.getMentorCandidates(token, regiment.id),
      ]);
      setCommanders(commandersData);
      setCandidates(candidatesData);
      setMentorCandidates(mentorCandidatesData);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    loadCommanders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (startingRankId && !availableRanks.some((r) => r.id === Number(startingRankId))) {
      setStartingRankId("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isJediOrder]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await api.updateRegiment(token, regiment.id, {
        name,
        discordRoleId,
        color,
        discordChannelUrl: discordChannelUrl.trim() || null,
        isJediOrder,
        startingRankId: startingRankId === "" ? null : Number(startingRankId),
      });
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
    if (selectedRoleType === "mentor") return;
    const candidate = candidates.find((c) => c.discord_id === discordId);
    if (candidate) {
      setSelectedRoleType(candidate.is_commander_role ? "commander" : "deputy");
    }
  }

  function handleSelectRoleType(roleType) {
    setSelectedRoleType(roleType);
    setSelectedCandidate("");
  }

  async function handleRemoveCommander(discordId) {
    try {
      await api.removeCommander(token, regiment.id, discordId);
      await loadCommanders();
    } catch (e) {
      setError(e.message);
    }
  }

  return createPortal(
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

        <label>
          Ссылка на Discord-канал формирования
          <input
            type="text"
            placeholder="https://discord.com/channels/..."
            value={discordChannelUrl}
            onChange={(e) => setDiscordChannelUrl(e.target.value)}
          />
        </label>

        <label className="checkbox-label">
          <input type="checkbox" checked={isJediOrder} onChange={(e) => setIsJediOrder(e.target.checked)} />
          Орден джедаев (основному профилю бойцов можно назначать только джедайские звания)
        </label>

        <label>
          Стартовое звание при регистрации
          <InfoHint text="Пусто — по умолчанию (Рекрут). Если у формирования нет рекрутского набора (принимают сразу с определённого звания), выберите его здесь." />
          <select value={startingRankId} onChange={(e) => setStartingRankId(e.target.value)}>
            <option value="">по умолчанию (Рекрут)</option>
            {availableRanks.map((r) => (
              <option key={r.id} value={r.id}>
                {r.code} — {r.name}
              </option>
            ))}
          </select>
        </label>

        <h4>
          Командиры
          <InfoHint text="Только эти люди получат командирские права над формированием — даже если у них есть общая роль «Командир» и роль этого формирования." />
        </h4>
        <ul className="category-list">
          {commanders.map((c) => (
            <li key={c.discord_id}>
              {c.username}{" "}
              <span className="hint-text">
                ({c.role_type === "mentor" ? "наставник" : c.role_type === "deputy" ? "заместитель" : "командир"})
              </span>
              <button className="ghost" onClick={() => handleRemoveCommander(c.discord_id)}>
                Снять
              </button>
            </li>
          ))}
        </ul>

        {(candidates.length > 0 || mentorCandidates.length > 0) && (
          <div className="add-category-form">
            <select value={selectedCandidate} onChange={(e) => handleSelectCandidate(e.target.value)}>
              <option value="">— выбрать участника —</option>
              {availableCandidates.map((c) => (
                <option key={c.discord_id} value={c.discord_id}>
                  {c.username}
                </option>
              ))}
            </select>
            <select value={selectedRoleType} onChange={(e) => handleSelectRoleType(e.target.value)}>
              <option value="commander">Командир</option>
              <option value="deputy">Заместитель</option>
              <option value="mentor">Наставник</option>
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
    </div>,
    document.body
  );
}
