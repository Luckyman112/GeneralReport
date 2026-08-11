import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { InfoHint } from "./Tooltip";
import { commanderRoleLabel, JEDI_COUNCIL_SEATS } from "../utils/regimentRoles";

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
  const [savingCouncilSeat, setSavingCouncilSeat] = useState(null);

  const [squads, setSquads] = useState([]);
  const [allMembers, setAllMembers] = useState([]);
  const [newSquadName, setNewSquadName] = useState("");
  const [expandedSquadId, setExpandedSquadId] = useState(null);
  const [tierLabelDrafts, setTierLabelDrafts] = useState({});
  const [selectedMemberBySquad, setSelectedMemberBySquad] = useState({});

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

  async function loadSquads() {
    try {
      const [squadsData, membersData] = await Promise.all([
        api.listSquads(token, regiment.id),
        api.getMembers(token, regiment.id),
      ]);
      setSquads(squadsData);
      setAllMembers(membersData);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    loadCommanders();
    loadSquads();
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

  async function handleSetCouncilSeat(seatValue, discordId) {
    setSavingCouncilSeat(seatValue);
    setError(null);
    try {
      // Должность уникальна (см. app/models/user.py::jedi_council_seat) — если
      // сменяем держателя, сначала снимаем со старого, иначе бэкенд отвергнет
      // назначение как дубликат
      const currentHolder = allMembers.find((m) => m.jedi_council_seat === seatValue);
      if (currentHolder && currentHolder.discord_id !== discordId) {
        await api.setMemberProfile(token, regiment.id, currentHolder.discord_id, { jedi_council_seat: null });
      }
      if (discordId) {
        await api.setMemberProfile(token, regiment.id, discordId, { jedi_council_seat: seatValue });
      }
      await loadSquads();
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingCouncilSeat(null);
    }
  }

  function memberName(discordId) {
    const m = allMembers.find((x) => x.discord_id === discordId);
    return m ? m.username : discordId;
  }

  async function handleCreateSquad() {
    const name = newSquadName.trim();
    if (!name) return;
    try {
      await api.createSquad(token, regiment.id, name);
      setNewSquadName("");
      await loadSquads();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDeleteSquad(squadId) {
    try {
      await api.deleteSquad(token, regiment.id, squadId);
      if (expandedSquadId === squadId) setExpandedSquadId(null);
      await loadSquads();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleSaveTierLabels(squadId) {
    const squad = squads.find((s) => s.id === squadId);
    const draft = tierLabelDrafts[squadId];
    if (!squad || !draft) return;
    try {
      await api.updateSquadTierLabels(token, regiment.id, squadId, draft);
      setTierLabelDrafts((prev) => {
        const next = { ...prev };
        delete next[squadId];
        return next;
      });
      await loadSquads();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleAddSquadMember(squadId) {
    const discordId = selectedMemberBySquad[squadId];
    const member = allMembers.find((m) => m.discord_id === discordId);
    if (!member) return;
    try {
      await api.addSquadMember(token, regiment.id, squadId, {
        discordId: member.discord_id,
        username: member.username,
        tier: 0,
      });
      setSelectedMemberBySquad((prev) => ({ ...prev, [squadId]: "" }));
      await loadSquads();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleUpdateSquadMemberTier(squadId, discordId, tier) {
    try {
      await api.updateSquadMemberTier(token, regiment.id, squadId, discordId, tier);
      await loadSquads();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleRemoveSquadMember(squadId, discordId) {
    try {
      await api.removeSquadMember(token, regiment.id, squadId, discordId);
      await loadSquads();
    } catch (e) {
      setError(e.message);
    }
  }

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" aria-label="Закрыть" onClick={onClose}>
          ×
        </button>
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
          {isJediOrder ? "Следящие за джедаями" : "Командиры"}
          <InfoHint text={`Только эти люди получат командирские права над формированием — даже если у них есть общая роль «${commanderRoleLabel("commander", isJediOrder)}» и роль этого формирования.`} />
        </h4>
        <ul className="category-list">
          {commanders.map((c) => (
            <li key={c.discord_id}>
              {c.username}{" "}
              <span className="hint-text">({commanderRoleLabel(c.role_type, isJediOrder).toLowerCase()})</span>
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
              <option value="commander">{commanderRoleLabel("commander", isJediOrder)}</option>
              <option value="deputy">Заместитель</option>
              <option value="mentor">Наставник</option>
            </select>
            <button type="button" disabled={!selectedCandidate} onClick={handleAddCommander}>
              Назначить
            </button>
          </div>
        )}

        {isJediOrder && (
          <>
            <h4>
              Главы направлений
              <InfoHint text="Совет Ордена — Консулы/Защитники/Стражи/Ученичество. Чистый титул, прав в системе не даёт (см. личное дело бойца)." />
            </h4>
            <ul className="category-list">
              {Object.entries(JEDI_COUNCIL_SEATS).map(([seatValue, seatLabel]) => {
                const holder = allMembers.find((m) => m.jedi_council_seat === seatValue);
                return (
                  <li key={seatValue}>
                    {seatLabel}: {holder ? holder.username : <span className="hint-text">не назначен</span>}
                    <select
                      value={holder?.discord_id ?? ""}
                      disabled={savingCouncilSeat === seatValue}
                      onChange={(e) => handleSetCouncilSeat(seatValue, e.target.value)}
                    >
                      <option value="">— не назначен —</option>
                      {allMembers.map((m) => (
                        <option key={m.discord_id} value={m.discord_id}>
                          {m.username}
                        </option>
                      ))}
                    </select>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        <h4>
          Отряды
          <InfoHint text="Подгруппы внутри формирования (например, отряд разведки или кинологов) — только ярлык и мини-иерархия в составе, никаких отдельных прав не даёт." />
        </h4>
        <ul className="category-list">
          {squads.map((squad) => {
            const draft = tierLabelDrafts[squad.id] ?? squad.tier_labels;
            const availableForSquad = allMembers.filter(
              (m) => !squad.members.some((sm) => sm.discord_id === m.discord_id)
            );
            return (
              <li key={squad.id} className="squad-block">
                <div className="squad-header">
                  <strong>{squad.name}</strong>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => setExpandedSquadId(expandedSquadId === squad.id ? null : squad.id)}
                  >
                    {expandedSquadId === squad.id ? "Свернуть" : "Состав"} ({squad.members.length})
                  </button>
                  <button type="button" className="ghost" onClick={() => handleDeleteSquad(squad.id)}>
                    Удалить
                  </button>
                </div>

                {expandedSquadId === squad.id && (
                  <div className="squad-detail">
                    <p className="hint-text">Подписи титулов (боец / старший / заместитель / командир):</p>
                    <div className="squad-tier-labels">
                      {draft.map((label, i) => (
                        <input
                          key={i}
                          value={label}
                          onChange={(e) => {
                            const next = [...draft];
                            next[i] = e.target.value;
                            setTierLabelDrafts((prev) => ({ ...prev, [squad.id]: next }));
                          }}
                        />
                      ))}
                      <button type="button" onClick={() => handleSaveTierLabels(squad.id)}>
                        Сохранить подписи
                      </button>
                    </div>

                    <ul className="category-list">
                      {squad.members.map((m) => (
                        <li key={m.discord_id}>
                          {memberName(m.discord_id)}{" "}
                          <select
                            value={m.tier}
                            onChange={(e) =>
                              handleUpdateSquadMemberTier(squad.id, m.discord_id, Number(e.target.value))
                            }
                          >
                            {squad.tier_labels.map((label, i) => (
                              <option key={i} value={i}>
                                {label}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => handleRemoveSquadMember(squad.id, m.discord_id)}
                          >
                            Снять
                          </button>
                        </li>
                      ))}
                    </ul>

                    {availableForSquad.length > 0 && (
                      <div className="add-category-form">
                        <select
                          value={selectedMemberBySquad[squad.id] || ""}
                          onChange={(e) =>
                            setSelectedMemberBySquad((prev) => ({ ...prev, [squad.id]: e.target.value }))
                          }
                        >
                          <option value="">— выбрать участника —</option>
                          {availableForSquad.map((m) => (
                            <option key={m.discord_id} value={m.discord_id}>
                              {m.username}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          disabled={!selectedMemberBySquad[squad.id]}
                          onClick={() => handleAddSquadMember(squad.id)}
                        >
                          Добавить
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        <div className="add-category-form">
          <input
            type="text"
            placeholder="Название отряда"
            value={newSquadName}
            onChange={(e) => setNewSquadName(e.target.value)}
          />
          <button type="button" disabled={!newSquadName.trim()} onClick={handleCreateSquad}>
            Создать отряд
          </button>
        </div>

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
