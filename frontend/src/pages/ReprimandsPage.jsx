import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { PageLoading } from "../components/PageLoading";
import { useToast } from "../components/ToastContext";
import { useLiveEvents } from "../hooks/useLiveEvents";
import { formatMskDate } from "../utils/formatDate";
import { formatFullName } from "../utils/formatName";

function AppealSection({ reprimand, isOwn, canEdit, onSaved }) {
  const { token } = useAuth();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(reprimand.appeal_text || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  if (!canEdit && !reprimand.appeal_text) return null;

  if (!editing) {
    return (
      <div className="hint-text">
        {reprimand.appeal_text ? (
          <>
            <strong>Пояснение:</strong> {reprimand.appeal_text}
          </>
        ) : (
          "Пояснения нет."
        )}
        {canEdit && (
          <button className="ghost" onClick={() => setEditing(true)}>
            {reprimand.appeal_text ? "Изменить" : "Оставить пояснение"}
          </button>
        )}
      </div>
    );
  }

  async function handleSave() {
    if (!text.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api.setReprimandAppeal(token, reprimand.id, text.trim());
      setEditing(false);
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="add-category-form">
      <input type="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Пояснение" />
      <button onClick={handleSave} disabled={saving}>
        Сохранить
      </button>
      <button className="ghost" onClick={() => setEditing(false)}>
        Отмена
      </button>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}

/** Отдельная страница выговоров — параллельно "Нарушителям": командир/заместитель
 * видит только своё формирование (с возможностью удалить запись), высшее
 * командование/админ видят все формирования с фильтром, обычный боец — только свои. */
export function ReprimandsPage() {
  const { token, user, access, regiments } = useAuth();
  const showToast = useToast();
  const [reprimands, setReprimands] = useState([]);
  const [regimentFilter, setRegimentFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const regimentsById = useMemo(() => Object.fromEntries(regiments.map((r) => [r.id, r])), [regiments]);
  const isFullViewer = access?.is_admin || access?.is_high_command;

  const load = useCallback(async () => {
    try {
      setReprimands(await api.listAllReprimands(token));
    } catch (e) {
      setError(e.message);
    }
  }, [token]);

  useLiveEvents("reprimands", load);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const presentRegimentIds = useMemo(
    () => [...new Set(reprimands.map((r) => r.regiment_id))],
    [reprimands]
  );
  const visibleReprimands = regimentFilter
    ? reprimands.filter((r) => r.regiment_id === Number(regimentFilter))
    : reprimands;

  function canManage(regimentId) {
    return access?.is_admin || access?.is_high_command || (access?.commander_regiment_ids || []).includes(regimentId);
  }

  async function handleSelfRevoke(id) {
    setError(null);
    try {
      await api.selfRevokeReprimand(token, id);
      await load();
      showToast("Выговор снят");
    } catch (e) {
      setError(e.message);
      showToast(e.message, "error");
    }
  }

  async function handleRevoke(reprimand) {
    setError(null);
    try {
      await api.revokeReprimand(token, reprimand.regiment_id, reprimand.id);
      await load();
      showToast("Запись удалена");
    } catch (e) {
      setError(e.message);
      showToast(e.message, "error");
    }
  }

  if (loading) return <PageLoading />;

  const reprimandPendingDelete = reprimands.find((r) => r.id === confirmDeleteId) || null;

  return (
    <div className="violations-page">
      <div className="reports-toolbar">
        <h2 style={{ margin: 0 }}>Выговоры</h2>
      </div>
      <p className="hint-text">
        Устный выговор ничего не ограничивает сам по себе, но два действующих устных выговора автоматически создают
        дополнительный строгий. Только строгий выговор блокирует повышение.
      </p>

      {error && <p className="error-text">{error}</p>}

      {isFullViewer && presentRegimentIds.length > 1 && (
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

      {visibleReprimands.length === 0 ? (
        <EmptyState text="Выговоров нет." />
      ) : (
        <div className="report-list">
          {visibleReprimands.map((r) => {
            const isOwn = r.target.discord_id === user?.discord_id;
            const canManageThis = canManage(r.regiment_id);
            const canSelfRevoke = isOwn && !r.revoked_at && r.points_required > 0 && r.points_earned >= r.points_required;
            return (
              <div key={r.id} className="report-row fade-in-up">
                <div className="report-row-header">
                  <span className="report-regiment">{formatFullName(r.target)}</span>
                  <span className="report-category">{regimentsById[r.regiment_id]?.name || `#${r.regiment_id}`}</span>
                  <span className={r.revoked_at ? "hint-text" : "error-text"}>
                    {r.revoked_at ? "снят" : "действует"} · {r.severity === "verbal" ? "устный" : "строгий"}
                    {r.auto_escalated && " · авто-эскалация"}
                  </span>
                  <span className="report-date">{formatMskDate(r.issued_at)} МСК</span>
                </div>
                <p className="report-content">{r.reason}</p>
                <p className="report-byline">Выдал: {formatFullName(r.issuer)}</p>
                {r.points_required > 0 && (
                  <p className="hint-text">
                    Для снятия нужно баллов: {r.points_required} (набрано: {r.points_earned})
                  </p>
                )}
                <AppealSection reprimand={r} isOwn={isOwn} canEdit={isOwn || canManageThis} onSaved={load} />
                <div className="report-row-actions">
                  {canSelfRevoke && (
                    <button className="primary" onClick={() => handleSelfRevoke(r.id)}>
                      Снять (баллов достаточно)
                    </button>
                  )}
                  {canManageThis && !r.revoked_at && (
                    <button onClick={() => setConfirmDeleteId(r.id)}>Удалить запись</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={reprimandPendingDelete != null}
        message="Удалить эту запись о выговоре? Действие необратимо."
        onConfirm={() => {
          handleRevoke(reprimandPendingDelete);
          setConfirmDeleteId(null);
        }}
        onCancel={() => setConfirmDeleteId(null)}
      />
    </div>
  );
}
