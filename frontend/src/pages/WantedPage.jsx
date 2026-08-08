import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { EmptyState } from "../components/EmptyState";
import { PageLoading } from "../components/PageLoading";
import { useToast } from "../components/ToastContext";
import { useLiveEvents } from "../hooks/useLiveEvents";
import { formatMskDate } from "../utils/formatDate";
import { formatFullName } from "../utils/formatName";

const RESOLUTION_LABELS = {
  detained: "Задержан",
  arrested: "Арестован",
  eliminated: "Ликвидирован",
  missing: "Пропал без вести",
  punished: "Наказан",
};

function emptyForm() {
  return { nickname: "", serviceId: "", rankId: "", regimentId: "", reason: "" };
}

function WantedForm({ onSubmit, onCancel }) {
  const { token, regiments } = useAuth();
  const [tiers, setTiers] = useState([]);
  const [form, setForm] = useState(emptyForm());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.getRanks(token).then(setTiers).catch(() => setTiers([]));
  }, [token]);

  function setField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  const isValid = form.nickname.trim() && form.reason.trim();

  async function handleSubmit(e) {
    e.preventDefault();
    if (!isValid) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        nickname: form.nickname.trim(),
        service_id: form.serviceId.trim() || null,
        rank_id: form.rankId ? Number(form.rankId) : null,
        regiment_id: form.regimentId ? Number(form.regimentId) : null,
        reason: form.reason.trim(),
      });
      setForm(emptyForm());
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="report-form fade-in-up" onSubmit={handleSubmit}>
      <h3>Объявить в розыск</h3>

      <label>
        Ник
        <input type="text" value={form.nickname} onChange={(e) => setField("nickname", e.target.value)} />
      </label>
      <label>
        ИДН (если известен)
        <input type="text" maxLength={4} value={form.serviceId} onChange={(e) => setField("serviceId", e.target.value)} />
      </label>
      <label>
        Звание (если известно)
        <select value={form.rankId} onChange={(e) => setField("rankId", e.target.value)}>
          <option value="">— не указано —</option>
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
        Формирование (если известно)
        <select value={form.regimentId} onChange={(e) => setField("regimentId", e.target.value)}>
          <option value="">— не указано —</option>
          {regiments.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        За что в розыске
        <textarea rows={4} value={form.reason} onChange={(e) => setField("reason", e.target.value)} />
      </label>

      {error && <p className="error-text">{error}</p>}

      <div className="report-form-actions">
        <button className="primary" type="submit" disabled={submitting || !isValid}>
          Объявить в розыск
        </button>
        <button className="ghost" type="button" onClick={onCancel}>
          Отмена
        </button>
      </div>
    </form>
  );
}

function ResolveInline({ entry, onResolve, onCancel }) {
  const [resolution, setResolution] = useState("");
  return (
    <div className="wanted-resolve-inline">
      <select value={resolution} onChange={(e) => setResolution(e.target.value)}>
        <option value="">— причина снятия —</option>
        {Object.entries(RESOLUTION_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <button className="primary" disabled={!resolution} onClick={() => onResolve(entry.id, resolution)}>
        Снять с розыска
      </button>
      <button className="ghost" onClick={onCancel}>
        Отмена
      </button>
    </div>
  );
}

export function WantedPage() {
  const { token, access, regiments } = useAuth();
  const showToast = useToast();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [resolvingId, setResolvingId] = useState(null);

  const regimentsById = Object.fromEntries(regiments.map((r) => [r.id, r]));
  const canManage = Boolean(access?.can_file_detention_report);

  function load() {
    api
      .listWanted(token)
      .then(setEntries)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useLiveEvents("wanted", load);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate(payload) {
    await api.createWanted(token, payload);
    showToast("Объявлен в розыск");
    setShowForm(false);
    load();
  }

  async function handleResolve(entryId, resolution) {
    try {
      await api.resolveWanted(token, entryId, resolution);
      showToast("Снят с розыска");
      setResolvingId(null);
      load();
    } catch (e) {
      showToast(e.message, "error");
    }
  }

  async function handleDelete(entryId) {
    try {
      await api.deleteWanted(token, entryId);
      showToast("Запись удалена");
      load();
    } catch (e) {
      showToast(e.message, "error");
    }
  }

  if (loading) return <PageLoading />;

  const active = entries.filter((e) => e.status !== "resolved");
  const archived = entries.filter((e) => e.status === "resolved");

  return (
    <div className="violations-page">
      <div className="reports-toolbar">
        <h2 style={{ margin: 0 }}>Розыск</h2>
        {canManage && !showForm && (
          <button className="primary" onClick={() => setShowForm(true)}>
            Объявить в розыск
          </button>
        )}
      </div>

      {error && <p className="error-text">{error}</p>}

      {showForm && <WantedForm onSubmit={handleCreate} onCancel={() => setShowForm(false)} />}

      {active.length === 0 ? (
        <EmptyState text="Никто не в розыске." />
      ) : (
        <div className="report-list">
          {active.map((e) => (
            <div key={e.id} className="report-row fade-in-up">
              <div className="report-row-header">
                <span className="report-regiment">{e.nickname}</span>
                {e.service_id && <span className="report-category">ИДН {e.service_id}</span>}
                {e.rank && <span className="report-category">{e.rank.code}</span>}
                {e.regiment_id && <span className="report-category">{regimentsById[e.regiment_id]?.name}</span>}
                <span className="report-date">{formatMskDate(e.created_at)} МСК</span>
              </div>
              <p className="report-content">{e.reason}</p>
              <p className="report-byline">Объявил: {formatFullName(e.author)}</p>
              {canManage && (
                <div className="report-row-actions">
                  {resolvingId === e.id ? (
                    <ResolveInline entry={e} onResolve={handleResolve} onCancel={() => setResolvingId(null)} />
                  ) : (
                    <button onClick={() => setResolvingId(e.id)}>Снять с розыска</button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {archived.length > 0 && (
        <>
          <button className="ghost" style={{ marginTop: "1.5rem" }} onClick={() => setShowArchive((v) => !v)}>
            {showArchive ? "Скрыть архив" : `Показать архив (${archived.length})`}
          </button>
          {showArchive && (
            <div className="report-list">
              {archived.map((e) => (
                <div key={e.id} className="report-row fade-in-up wanted-archived-row">
                  <div className="report-row-header">
                    <span className="report-regiment">{e.nickname}</span>
                    {e.regiment_id && <span className="report-category">{regimentsById[e.regiment_id]?.name}</span>}
                    <span className="report-date">{formatMskDate(e.created_at)} МСК</span>
                  </div>
                  <p className="report-content">{e.reason}</p>
                  <p className="report-byline">
                    Объявил: {formatFullName(e.author)} · Снял: {formatFullName(e.resolved_by_user)} (
                    {formatMskDate(e.resolved_at)} МСК)
                  </p>
                  <span className="wanted-resolution-badge">{RESOLUTION_LABELS[e.resolution] || e.resolution}</span>
                  {access?.is_admin && (
                    <div className="report-row-actions">
                      <button onClick={() => handleDelete(e.id)}>Удалить</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
