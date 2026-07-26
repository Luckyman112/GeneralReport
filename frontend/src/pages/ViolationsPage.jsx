import { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { PageLoading } from "../components/PageLoading";
import { useToast } from "../components/ToastContext";
import { downloadCsv } from "../utils/csv";
import { formatMskDate } from "../utils/formatDate";
import { formatFullName } from "../utils/formatName";

function formatViolationTarget(v) {
  if (v.target_username) return v.target_username;
  if (v.target_service_id && v.target_rank && v.target_callsign) {
    return `${v.target_service_id} ${v.target_rank.code} ${v.target_callsign}`;
  }
  return "Неизвестно";
}

const PUNISHMENT_LABELS = {
  verbal: "Устное предупреждение",
  skt: "СКТ",
  detention: "Задержание",
  other: "Другое",
};

function formatPunishment(v) {
  if (!v.punishment_type) return null;
  const label = v.punishment_type === "other" ? v.punishment_other_text || "Другое" : PUNISHMENT_LABELS[v.punishment_type];
  return v.punishment_amount ? `${label} — ${v.punishment_amount}` : label;
}

function ModuleAccessSettings() {
  const { token, regiments } = useAuth();
  const [roles, setRoles] = useState([]);
  const [access, setAccess] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    Promise.all([api.getDiscordRoles(token), api.getModuleAccess(token)]).then(([rolesData, accessData]) => {
      setRoles(rolesData);
      setAccess(accessData);
    });
  }, [token]);

  function toggleRegiment(field, id) {
    setAccess((prev) => ({
      ...prev,
      [field]: prev[field].includes(id) ? prev[field].filter((x) => x !== id) : [...prev[field], id],
    }));
  }

  function toggleRole(field, id) {
    setAccess((prev) => ({
      ...prev,
      [field]: prev[field].includes(id) ? prev[field].filter((x) => x !== id) : [...prev[field], id],
    }));
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await api.updateModuleAccess(token, access);
      setSaved(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  if (!access) return <p>Загрузка...</p>;

  return (
    <div className="regiment-panel fade-in-up">
      <h4>Настройки модуля (администратор)</h4>

      <p className="hint-text">Кто может заводить записи о нарушениях (рапорт о задержании) — по формированию:</p>
      <div className="field-tags">
        {regiments.map((r) => (
          <label key={r.id} className="checkbox-label field-tag">
            <input
              type="checkbox"
              checked={access.violation_writer_regiment_ids.includes(r.id)}
              onChange={() => toggleRegiment("violation_writer_regiment_ids", r.id)}
            />
            {r.name}
          </label>
        ))}
      </div>
      <p className="hint-text">...или по Discord-роли:</p>
      <div className="field-tags">
        {roles.map((role) => (
          <label key={role.id} className="checkbox-label field-tag">
            <input
              type="checkbox"
              checked={access.violation_writer_role_ids.includes(role.id)}
              onChange={() => toggleRole("violation_writer_role_ids", role.id)}
            />
            {role.name}
          </label>
        ))}
      </div>

      <p className="hint-text">
        Кто может видеть весь список (помимо этого, всегда видят командиры/заместители своего формирования) — по
        формированию:
      </p>
      <div className="field-tags">
        {regiments.map((r) => (
          <label key={r.id} className="checkbox-label field-tag">
            <input
              type="checkbox"
              checked={access.violation_viewer_regiment_ids.includes(r.id)}
              onChange={() => toggleRegiment("violation_viewer_regiment_ids", r.id)}
            />
            {r.name}
          </label>
        ))}
      </div>
      <p className="hint-text">...или по Discord-роли:</p>
      <div className="field-tags">
        {roles.map((role) => (
          <label key={role.id} className="checkbox-label field-tag">
            <input
              type="checkbox"
              checked={access.violation_viewer_role_ids.includes(role.id)}
              onChange={() => toggleRole("violation_viewer_role_ids", role.id)}
            />
            {role.name}
          </label>
        ))}
      </div>

      <p className="hint-text">Кто может отправлять объявления всем (кнопка рассылки в шапке):</p>
      <div className="field-tags">
        {roles.map((role) => (
          <label key={role.id} className="checkbox-label field-tag">
            <input
              type="checkbox"
              checked={access.broadcast_role_ids.includes(role.id)}
              onChange={() => toggleRole("broadcast_role_ids", role.id)}
            />
            {role.name}
          </label>
        ))}
      </div>

      <p className="hint-text">Кому в разделе "Рапорты" видна кнопка "Рапорт о задержании" — по Discord-роли:</p>
      <div className="field-tags">
        {roles.map((role) => (
          <label key={role.id} className="checkbox-label field-tag">
            <input
              type="checkbox"
              checked={access.detention_report_role_ids.includes(role.id)}
              onChange={() => toggleRole("detention_report_role_ids", role.id)}
            />
            {role.name}
          </label>
        ))}
      </div>

      <div className="report-form-actions">
        <button className="primary" onClick={handleSave} disabled={saving}>
          Сохранить настройки доступа
        </button>
      </div>

      {error && <p className="error-text">{error}</p>}
      {saved && <p className="hint-text">Сохранено.</p>}
    </div>
  );
}

export function ViolationsPage() {
  const { token, access, regiments } = useAuth();
  const showToast = useToast();
  const [violations, setViolations] = useState([]);
  const [regimentFilter, setRegimentFilter] = useState("");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const regimentsById = Object.fromEntries(regiments.map((r) => [r.id, r]));

  async function load() {
    try {
      setViolations(await api.listViolations(token, { search: search.trim() || undefined, dateFrom: dateFrom || undefined, dateTo: dateTo || undefined }));
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

  useEffect(() => {
    const timeout = setTimeout(() => {
      load().catch((e) => setError(e.message));
    }, 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, dateFrom, dateTo]);

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
      showToast("Запись удалена");
    } catch (e) {
      setError(e.message);
      showToast(e.message, "error");
    }
  }

  function exportCsv() {
    downloadCsv(
      "violations.csv",
      ["Нарушитель", "Формирование", "Наказание", "Описание", "Зафиксировал", "Дата"],
      visibleViolations.map((v) => [
        formatViolationTarget(v),
        v.target_regiment_id ? regimentsById[v.target_regiment_id]?.name : "",
        formatPunishment(v) || "",
        v.description,
        formatFullName(v.author),
        formatMskDate(v.created_at),
      ])
    );
  }

  if (loading) return <PageLoading />;

  return (
    <div className="violations-page">
      <div className="reports-toolbar">
        <h2 style={{ margin: 0 }}>Нарушители</h2>
        {visibleViolations.length > 0 && (
          <button className="ghost" onClick={exportCsv}>
            Экспорт в CSV
          </button>
        )}
      </div>

      {error && <p className="error-text">{error}</p>}

      <div className="violations-filters">
        <label className="violation-filter-label">
          Поиск (позывной / ИДН / ник)
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Например: Demiyrg"
          />
        </label>
        <label className="violation-filter-label">
          С даты
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </label>
        <label className="violation-filter-label">
          По дату
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </label>
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
      </div>

      {visibleViolations.length === 0 ? (
        <EmptyState text="Записей о нарушениях нет." />
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
              {formatPunishment(v) && (
                <p className="hint-text">
                  <strong>Наказание:</strong> {formatPunishment(v)}
                </p>
              )}
              <p className="report-byline">Зафиксировал: {formatFullName(v.author)}</p>
              {access?.is_admin && (
                <div className="report-row-actions">
                  <button onClick={() => setConfirmDeleteId(v.id)}>Удалить</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={confirmDeleteId != null}
        message="Удалить эту запись о нарушении? Действие необратимо."
        onConfirm={() => {
          handleDelete(confirmDeleteId);
          setConfirmDeleteId(null);
        }}
        onCancel={() => setConfirmDeleteId(null)}
      />

      {access?.is_admin && <ModuleAccessSettings />}
    </div>
  );
}
