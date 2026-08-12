import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { ActivityTrendPanel } from "../components/ActivityTrendPanel";
import { AdminMemberDetailModal } from "../components/AdminMemberDetailModal";
import { EmptyState } from "../components/EmptyState";
import { MemberSearchPicker } from "../components/MemberSearchPicker";
import { PageLoading } from "../components/PageLoading";
import { useToast } from "../components/ToastContext";
import { formatMskDate } from "../utils/formatDate";

const STATUS_LABELS = { pending: "Ожидает решения", approved: "Одобрен", rejected: "Отклонён" };

const ACTIVITY_FIELDS = [
  { key: "nickname", label: "Игровой никнейм" },
  { key: "position", label: "Должность" },
  { key: "activity_type", label: "Вид деятельности" },
  { key: "completion_date", label: "Дата выполнения", type: "date" },
];

const PUNISHMENT_FIELDS = [
  { key: "nickname", label: "Игровой никнейм" },
  { key: "position", label: "Должность" },
  { key: "punishment_issued", label: "Выдано наказание" },
  { key: "reason", label: "Причина наказания" },
  { key: "duration", label: "Срок наказания" },
];

const TYPE_LABELS = { activity: "Отчёт деятельности", punishment: "Отчёт наказаний" };

// Решённый отчёт старше этого срока уходит в свёрнутый архив, чтобы список не
// захламлялся (см. решение пользователя, п.3 из батча правок) — pending всегда активен.
const ARCHIVE_AFTER_DAYS = 14;

function isArchivedReport(r) {
  if (r.status === "pending" || !r.decided_at) return false;
  const ageMs = Date.now() - new Date(r.decided_at).getTime();
  return ageMs > ARCHIVE_AFTER_DAYS * 24 * 60 * 60 * 1000;
}

/** Администрация — нон-РП должность (модерация сервера: баны/муты/выдача
 * предметов), не связана с РП-формированиями (см. решение пользователя —
 * можно одновременно быть сержантом полка и Куратором Администрации). Своя
 * отчётность (не Report/ReportCategory), см. app/models/admin_report.py. */
export function AdminStaffPage() {
  const { token, access } = useAuth();
  const showToast = useToast();
  const [reports, setReports] = useState([]);
  const [summary, setSummary] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [selectedDiscordId, setSelectedDiscordId] = useState(null);

  const [reportType, setReportType] = useState("activity");
  const [fieldValues, setFieldValues] = useState({});
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [memberCandidates, setMemberCandidates] = useState([]);
  const [punishmentTargetId, setPunishmentTargetId] = useState("");

  const fields = reportType === "activity" ? ACTIVITY_FIELDS : PUNISHMENT_FIELDS;

  const fetchTrend = useCallback((range) => api.getAdminActivityTrend(token, range), [token]);

  function loadReports() {
    api
      .listAdminReports(token)
      .then(setReports)
      .catch((e) => setError(e.message));
  }

  useEffect(() => {
    Promise.all([api.listAdminReports(token), api.getAdminActivitySummary(token), api.getAdminMemberCandidates(token)])
      .then(([reportsData, summaryData, membersData]) => {
        setReports(reportsData);
        setSummary(summaryData);
        setMemberCandidates(membersData);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  function setField(key, value) {
    setFieldValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleAttachmentUpload(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const { url } = await api.uploadAdminReportAttachment(token, file);
      setAttachmentUrl(url);
      showToast("Вложение загружено");
    } catch (err) {
      setError(err.message);
      showToast(err.message, "error");
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const target = memberCandidates.find((m) => m.discord_id === punishmentTargetId);
      await api.createAdminReport(token, {
        reportType,
        payload: {
          ...fieldValues,
          attachment_url: attachmentUrl || null,
          // Необязательное поле — кому выдано наказание (см. решение
          // пользователя: может быть любого формирования, можно не указывать)
          ...(reportType === "punishment"
            ? {
                punishment_target_discord_id: target?.discord_id || null,
                punishment_target: target?.username || null,
              }
            : {}),
        },
      });
      setFieldValues({});
      setAttachmentUrl("");
      setPunishmentTargetId("");
      showToast("Отчёт отправлен");
      loadReports();
    } catch (err) {
      setError(err.message);
      showToast(err.message, "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDecide(reportId, status) {
    try {
      await api.decideAdminReport(token, reportId, { status });
      showToast(status === "approved" ? "Отчёт одобрен" : "Отчёт отклонён");
      loadReports();
    } catch (e) {
      showToast(e.message, "error");
    }
  }

  function renderReportRow(r) {
    return (
      <div key={r.id} className="report-row">
        <span className={`status-badge status-${r.status}`}>{STATUS_LABELS[r.status] || r.status}</span>
        <span className="report-category">{TYPE_LABELS[r.report_type] || r.report_type}</span>
        <span className="member-report-date">{formatMskDate(r.created_at)} МСК</span>
        <p className="report-byline">Подал: {r.submitted_by?.nickname_override || r.submitted_by?.username}</p>
        <ul className="member-report-list">
          {Object.entries(r.payload)
            .filter(([key, value]) => key !== "attachment_url" && key !== "punishment_target_discord_id" && value)
            .map(([key, value]) => (
              <li key={key}>{value}</li>
            ))}
        </ul>
        {r.payload.attachment_url && (
          <a href={r.payload.attachment_url} target="_blank" rel="noreferrer">
            Вложение
          </a>
        )}
        {r.status === "rejected" && r.rejection_reason && (
          <p className="report-rejection-reason">Причина отклонения: {r.rejection_reason}</p>
        )}
        {r.status === "pending" && access?.can_decide_admin_report && (
          <div className="report-form-actions">
            <button type="button" onClick={() => handleDecide(r.id, "approved")}>
              Одобрить
            </button>
            <button type="button" className="ghost error-text" onClick={() => handleDecide(r.id, "rejected")}>
              Отклонить
            </button>
          </div>
        )}
      </div>
    );
  }

  const activeReports = reports.filter((r) => !isArchivedReport(r));
  const archivedReports = reports.filter(isArchivedReport);

  if (loading) return <PageLoading />;

  return (
    <div className="page-container">
      <h2>Администрация</h2>

      {error && <p className="error-text">{error}</p>}

      {(access?.is_admin_staff || access?.is_admin) && (
        <form className="report-form fade-in-up" onSubmit={handleSubmit}>
          <h3>Подать отчёт</h3>
          <label>
            Тип отчёта
            <select
              value={reportType}
              onChange={(e) => {
                setReportType(e.target.value);
                setFieldValues({});
                setPunishmentTargetId("");
              }}
            >
              <option value="activity">Отчёт деятельности</option>
              <option value="punishment">Отчёт наказаний</option>
            </select>
          </label>
          {fields.map((f) => (
            <label key={f.key}>
              {f.label}
              <input
                type={f.type || "text"}
                value={fieldValues[f.key] || ""}
                onChange={(e) => setField(f.key, e.target.value)}
              />
            </label>
          ))}
          {reportType === "punishment" && (
            <label>
              Кому выдано наказание (необязательно — любое формирование)
              <MemberSearchPicker members={memberCandidates} selectedId={punishmentTargetId} onSelect={setPunishmentTargetId} />
            </label>
          )}
          <label>
            Прикреплённое доказательство (скриншот/видео)
            <input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" onChange={handleAttachmentUpload} />
          </label>
          {attachmentUrl && (
            <p className="hint-text">
              Вложение прикреплено: <a href={attachmentUrl} target="_blank" rel="noreferrer">открыть</a>
            </p>
          )}
          <div className="report-form-actions">
            <button className="primary" type="submit" disabled={submitting || uploading}>
              Отправить
            </button>
          </div>
        </form>
      )}

      <h3>Отчёты</h3>
      {reports.length === 0 ? (
        <EmptyState text="Отчётов пока нет." />
      ) : (
        <>
          {activeReports.length === 0 ? (
            <EmptyState text="Активных отчётов нет." />
          ) : (
            <div className="report-list">{activeReports.map(renderReportRow)}</div>
          )}
          {archivedReports.length > 0 && (
            <details className="event-archive-strip" style={{ marginTop: "0.75rem" }}>
              <summary>
                <span className="event-archive-strip-title">Архив ({archivedReports.length})</span>
              </summary>
              <div className="event-archive-list">{archivedReports.map(renderReportRow)}</div>
            </details>
          )}
        </>
      )}

      <h3>Сводка активности</h3>
      {summary.length === 0 ? (
        <EmptyState text="Состав Администрации не настроен или пуст." />
      ) : (
        <div className="roster-table-wrap">
          <table className="roster-table roster-table-wide">
            <thead>
              <tr>
                <th>Боец</th>
                <th>Должность</th>
                <th>Деятельность (7д / 30д / всего)</th>
                <th>Наказания (7д / 30д / всего)</th>
                <th>Выговоры</th>
                <th>Последний отчёт</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((s) => (
                <tr key={s.discord_id}>
                  <td>
                    <span className="clickable-row" onClick={() => setSelectedDiscordId(s.discord_id)}>
                      {s.username}
                    </span>
                  </td>
                  <td>{s.rank_label}</td>
                  <td className="mono-num">
                    {s.activity_count_week} / {s.activity_count_month} / {s.activity_count_all_time}
                  </td>
                  <td className="mono-num">
                    {s.punishment_count_week} / {s.punishment_count_month} / {s.punishment_count_all_time}
                  </td>
                  <td>
                    {s.active_reprimand_count > 0 ? (
                      <span className="status-badge status-rejected">{s.active_reprimand_count}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>{s.last_report_at ? `${formatMskDate(s.last_report_at)} МСК` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ActivityTrendPanel title="Активность по дням" fetchTrend={fetchTrend} />

      {selectedDiscordId && (
        <AdminMemberDetailModal discordId={selectedDiscordId} onClose={() => setSelectedDiscordId(null)} />
      )}
    </div>
  );
}
