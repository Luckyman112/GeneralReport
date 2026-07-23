import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { MemberSearchPicker } from "../components/MemberSearchPicker";
import { formatMskDate } from "../utils/formatDate";
import { formatFullName } from "../utils/formatName";

function formatViolationTarget(v) {
  if (v.target_username) return v.target_username;
  if (v.target_service_id && v.target_rank && v.target_callsign) {
    return `${v.target_service_id} ${v.target_rank.code} ${v.target_callsign}`;
  }
  return "Неизвестно";
}

function ViolationForm({ onCreated }) {
  const { token, regiments } = useAuth();
  const [mode, setMode] = useState("discord");
  const [members, setMembers] = useState([]);
  const [targetId, setTargetId] = useState("");
  const [tiers, setTiers] = useState([]);
  const [serviceId, setServiceId] = useState("");
  const [rankId, setRankId] = useState("");
  const [regimentId, setRegimentId] = useState("");
  const [callsign, setCallsign] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.getViolationTargetCandidates(token).then(setMembers).catch(() => setMembers([]));
    api.getRanks(token).then(setTiers).catch(() => setTiers([]));
  }, [token]);

  const isValid =
    description.trim() &&
    (mode === "discord" ? Boolean(targetId) : serviceId.trim() && rankId && regimentId && callsign.trim());

  async function handleSubmit(e) {
    e.preventDefault();
    if (!isValid) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.createViolation(token, {
        targetDiscordId: mode === "discord" ? targetId : null,
        targetServiceId: mode === "manual" ? serviceId.trim() : null,
        targetRankId: mode === "manual" ? Number(rankId) : null,
        targetRegimentId: mode === "manual" ? Number(regimentId) : null,
        targetCallsign: mode === "manual" ? callsign.trim() : null,
        description: description.trim(),
      });
      setTargetId("");
      setServiceId("");
      setRankId("");
      setRegimentId("");
      setCallsign("");
      setDescription("");
      onCreated();
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="report-form fade-in-up" onSubmit={handleSubmit}>
      <h3>Новая запись о нарушении</h3>

      <div className="violation-mode-toggle">
        <button type="button" className={mode === "discord" ? "primary" : ""} onClick={() => setMode("discord")}>
          Участник Discord
        </button>
        <button type="button" className={mode === "manual" ? "primary" : ""} onClick={() => setMode("manual")}>
          Вручную (не в Discord)
        </button>
      </div>

      {mode === "discord" ? (
        <label>
          Нарушитель
          <MemberSearchPicker members={members} selectedId={targetId} onSelect={setTargetId} />
        </label>
      ) : (
        <>
          <label>
            ИДН (4 цифры)
            <input type="text" maxLength={4} value={serviceId} onChange={(e) => setServiceId(e.target.value)} />
          </label>
          <label>
            Звание
            <select value={rankId} onChange={(e) => setRankId(e.target.value)}>
              <option value="">— выбрать —</option>
              {tiers.map((tier) => (
                <optgroup key={tier.id} label={tier.name}>
                  {tier.ranks.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.code} — {r.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label>
            Формирование
            <select value={regimentId} onChange={(e) => setRegimentId(e.target.value)}>
              <option value="">— выбрать —</option>
              {regiments.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Позывной
            <input type="text" value={callsign} onChange={(e) => setCallsign(e.target.value)} />
          </label>
        </>
      )}

      <label>
        Описание нарушения
        <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      {error && <p className="error-text">{error}</p>}
      <div className="report-form-actions">
        <button className="primary" type="submit" disabled={submitting || !isValid}>
          Зафиксировать
        </button>
      </div>
    </form>
  );
}

function ViolationAdminSettings() {
  const { token, regiments } = useAuth();
  const [writerIds, setWriterIds] = useState([]);
  const [viewerIds, setViewerIds] = useState([]);
  const [broadcastTitle, setBroadcastTitle] = useState("");
  const [broadcastBody, setBroadcastBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.getViolationSettings(token).then((data) => {
      setWriterIds(data.violation_writer_regiment_ids);
      setViewerIds(data.violation_viewer_regiment_ids);
    });
  }, [token]);

  function toggle(list, setList, id) {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }

  async function handleSaveSettings() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.updateViolationSettings(token, { writer_regiment_ids: writerIds, viewer_regiment_ids: viewerIds });
      setSaved(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleSendBroadcast(e) {
    e.preventDefault();
    if (!broadcastTitle.trim() || !broadcastBody.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api.sendBroadcast(token, { title: broadcastTitle.trim(), body: broadcastBody.trim() });
      setBroadcastTitle("");
      setBroadcastBody("");
      setSaved(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="regiment-panel fade-in-up">
      <h4>Настройки модуля (администратор)</h4>

      <p className="hint-text">Кто может заводить записи о нарушениях:</p>
      <div className="field-tags">
        {regiments.map((r) => (
          <label key={r.id} className="checkbox-label field-tag">
            <input
              type="checkbox"
              checked={writerIds.includes(r.id)}
              onChange={() => toggle(writerIds, setWriterIds, r.id)}
            />
            {r.name}
          </label>
        ))}
      </div>

      <p className="hint-text">
        Кто может видеть весь список (помимо этого, всегда видят командиры/заместители своего формирования):
      </p>
      <div className="field-tags">
        {regiments.map((r) => (
          <label key={r.id} className="checkbox-label field-tag">
            <input
              type="checkbox"
              checked={viewerIds.includes(r.id)}
              onChange={() => toggle(viewerIds, setViewerIds, r.id)}
            />
            {r.name}
          </label>
        ))}
      </div>

      <div className="report-form-actions">
        <button onClick={handleSaveSettings} disabled={saving}>
          Сохранить настройки доступа
        </button>
      </div>

      <h4>Отправить объявление всем</h4>
      <form onSubmit={handleSendBroadcast}>
        <label>
          Заголовок
          <input type="text" value={broadcastTitle} onChange={(e) => setBroadcastTitle(e.target.value)} />
        </label>
        <label>
          Текст
          <textarea rows={3} value={broadcastBody} onChange={(e) => setBroadcastBody(e.target.value)} />
        </label>
        <div className="report-form-actions">
          <button className="primary" type="submit" disabled={saving}>
            Отправить
          </button>
        </div>
      </form>

      {error && <p className="error-text">{error}</p>}
      {saved && <p className="hint-text">Сохранено.</p>}
    </div>
  );
}

export function ViolationsPage() {
  const { token, access, regiments } = useAuth();
  const [violations, setViolations] = useState([]);
  const [regimentFilter, setRegimentFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const regimentsById = Object.fromEntries(regiments.map((r) => [r.id, r]));

  async function load() {
    try {
      setViolations(await api.listViolations(token));
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    load()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Формирования, реально встречающиеся в видимом списке — только по ним и даём фильтровать
  const presentRegimentIds = useMemo(
    () => [...new Set(violations.map((v) => v.target_regiment_id).filter(Boolean))],
    [violations]
  );
  const visibleViolations = regimentFilter
    ? violations.filter((v) => v.target_regiment_id === Number(regimentFilter))
    : violations;

  async function handleDelete(id) {
    try {
      await api.deleteViolation(token, id);
      await load();
    } catch (e) {
      setError(e.message);
    }
  }

  if (loading) return <div className="page-loading">Загрузка...</div>;

  return (
    <div className="violations-page">
      <h2>Нарушители</h2>

      {error && <p className="error-text">{error}</p>}

      {access?.can_write_violations && <ViolationForm onCreated={load} />}

      {presentRegimentIds.length > 1 && (
        <label className="violation-filter-label">
          Формирование
          <select value={regimentFilter} onChange={(e) => setRegimentFilter(e.target.value)}>
            <option value="">Все формирования</option>
            {presentRegimentIds.map((id) => (
              <option key={id} value={id}>
                {regimentsById[id]?.name || `#${id}`}
              </option>
            ))}
          </select>
        </label>
      )}

      {visibleViolations.length === 0 ? (
        <p className="empty-state">Записей о нарушениях нет.</p>
      ) : (
        <div className="report-list">
          {visibleViolations.map((v) => (
            <div key={v.id} className="report-row fade-in-up">
              <div className="report-row-header">
                <span className="report-regiment">{formatViolationTarget(v)}</span>
                {v.target_regiment_id && (
                  <span className="report-category">{regimentsById[v.target_regiment_id]?.name}</span>
                )}
                <span className="report-date">{formatMskDate(v.created_at)} МСК</span>
              </div>
              <p className="report-content">{v.description}</p>
              <p className="report-byline">Зафиксировал: {formatFullName(v.author)}</p>
              {access?.is_admin && (
                <div className="report-row-actions">
                  <button onClick={() => handleDelete(v.id)}>Удалить</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {access?.is_admin && <ViolationAdminSettings />}
    </div>
  );
}
