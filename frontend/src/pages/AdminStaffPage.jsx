import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { EmptyState } from "../components/EmptyState";
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
  { key: "punishment_target", label: "Кому выдано наказание" },
  { key: "reason", label: "Причина наказания" },
  { key: "duration", label: "Срок наказания" },
];

const TYPE_LABELS = { activity: "Отчёт деятельности", punishment: "Отчёт наказаний" };

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

  const [reportType, setReportType] = useState("activity");
  const [fieldValues, setFieldValues] = useState({});
  const [attachmentUrl, setAttachmentUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const fields = reportType === "activity" ? ACTIVITY_FIELDS : PUNISHMENT_FIELDS;

  function loadReports() {
    api
      .listAdminReports(token)
      .then(setReports)
      .catch((e) => setError(e.message));
  }

  useEffect(() => {
    Promise.all([api.listAdminReports(token), api.getAdminActivitySummary(token)])
      .then(([reportsData, summaryData]) => {
        setReports(reportsData);
        setSummary(summaryData);
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
      await api.createAdminReport(token, {
        reportType,
        payload: { ...fieldValues, attachment_url: attachmentUrl || null },
      });
      setFieldValues({});
      setAttachmentUrl("");
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

  if (loading) return <PageLoading />;

  return (
    <div className="page-container">
      <h2>Администрация</h2>
      <p className="hint-text">
        Нон-РП должность (модерация сервера) — не связана с РП-формированиями. Здесь публикуется вся деятельность
        Администрации, помимо выдачи наказаний, и сами отчёты о выданных наказаниях.
      </p>

      {error && <p className="error-text">{error}</p>}

      {access?.is_admin_staff && (
        <form className="report-form fade-in-up" onSubmit={handleSubmit}>
          <h3>Подать отчёт</h3>
          <label>
            Тип отчёта
            <select value={reportType} onChange={(e) => { setReportType(e.target.value); setFieldValues({}); }}>
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
        <div className="report-list">
          {reports.map((r) => (
            <div key={r.id} className="report-row">
              <span className={`status-badge status-${r.status}`}>{STATUS_LABELS[r.status] || r.status}</span>
              <span className="report-category">{TYPE_LABELS[r.report_type] || r.report_type}</span>
              <span className="member-report-date">{formatMskDate(r.created_at)} МСК</span>
              <p className="report-byline">Подал: {r.submitted_by?.nickname_override || r.submitted_by?.username}</p>
              <ul className="member-report-list">
                {Object.entries(r.payload)
                  .filter(([key, value]) => key !== "attachment_url" && value)
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
          ))}
        </div>
      )}

      <h3>Сводка активности</h3>
      {summary.length === 0 ? (
        <EmptyState text="Состав Администрации не настроен или пуст." />
      ) : (
        <div className="roster-table-wrap">
          <table className="roster-table">
            <thead>
              <tr>
                <th>Боец</th>
                <th>Должность</th>
                <th>За неделю</th>
                <th>За месяц</th>
                <th>Всего</th>
                <th>Последний отчёт</th>
              </tr>
            </thead>
            <tbody>
              {summary.map((s) => (
                <tr key={s.discord_id}>
                  <td>{s.username}</td>
                  <td>{s.rank_label}</td>
                  <td className="mono-num">{s.count_week}</td>
                  <td className="mono-num">{s.count_month}</td>
                  <td className="mono-num">{s.count_all_time}</td>
                  <td>{s.last_report_at ? `${formatMskDate(s.last_report_at)} МСК` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
