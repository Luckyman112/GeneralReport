import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { MemberSearchPicker } from "../components/MemberSearchPicker";
import { formatMskDate } from "../utils/formatDate";
import { formatFullName } from "../utils/formatName";

function ViolationForm({ onCreated }) {
  const { token } = useAuth();
  const [members, setMembers] = useState([]);
  const [targetId, setTargetId] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.getViolationTargetCandidates(token).then(setMembers).catch(() => setMembers([]));
  }, [token]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!targetId || !description.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.createViolation(token, { targetDiscordId: targetId, description: description.trim() });
      setTargetId("");
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
      <label>
        Нарушитель
        <MemberSearchPicker members={members} selectedId={targetId} onSelect={setTargetId} />
      </label>
      <label>
        Описание нарушения
        <textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      {error && <p className="error-text">{error}</p>}
      <div className="report-form-actions">
        <button className="primary" type="submit" disabled={submitting || !targetId || !description.trim()}>
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
        Кто может видеть весь список (помимо этого, всегда видят командиры/заместители любого формирования):
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

      {violations.length === 0 ? (
        <p className="empty-state">Записей о нарушениях нет.</p>
      ) : (
        <div className="report-list">
          {violations.map((v) => (
            <div key={v.id} className="report-row fade-in-up">
              <div className="report-row-header">
                <span className="report-regiment">{v.target_username}</span>
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
