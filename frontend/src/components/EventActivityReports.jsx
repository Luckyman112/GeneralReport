import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { EmptyState } from "./EmptyState";
import { MemberSearchPicker } from "./MemberSearchPicker";
import { useToast } from "./ToastContext";
import { formatMskDate } from "../utils/formatDate";

const TYPE_LABELS = { mini: "Мини-ивент", combat: "Боевой вылет" };
const STATUS_LABELS = { pending: "Ожидает решения", approved: "Одобрен", rejected: "Отклонён" };

/** Отчёты Ивентологов о проведённых мероприятиях — отдельно от заявок на ивент
 * (те бронируют/описывают ивент ДО его проведения), см.
 * app/models/event_activity_report.py. Пинг проводящего = сам автор рапорта,
 * "помогавшего" указывают явно (только Ивентологи, не Администрацию — см.
 * решение пользователя). */
export function EventActivityReports() {
  const { token, access } = useAuth();
  const showToast = useToast();
  const [reports, setReports] = useState([]);
  const [summary, setSummary] = useState([]);
  const [members, setMembers] = useState([]);
  const [error, setError] = useState(null);

  const [eventType, setEventType] = useState("mini");
  const [coHostId, setCoHostId] = useState("");
  const [rating, setRating] = useState("");
  const [screenshotUrls, setScreenshotUrls] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function loadReports() {
    api
      .listEventActivityReports(token)
      .then(setReports)
      .catch((e) => setError(e.message));
  }

  useEffect(() => {
    Promise.all([
      api.listEventActivityReports(token),
      api.getEventActivitySummary(token),
      api.getEventMemberCandidates(token),
    ])
      .then(([reportsData, summaryData, membersData]) => {
        setReports(reportsData);
        setSummary(summaryData);
        setMembers(membersData);
      })
      .catch((e) => setError(e.message));
  }, [token]);

  async function handleAttachmentUpload(e) {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const { url } = await api.uploadEventActivityReportAttachment(token, file);
      setScreenshotUrls((prev) => [...prev, url]);
      showToast("Скриншот загружен");
    } catch (err) {
      setError(err.message);
      showToast(err.message, "error");
    } finally {
      setUploading(false);
    }
  }

  function removeScreenshot(url) {
    setScreenshotUrls((prev) => prev.filter((u) => u !== url));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.createEventActivityReport(token, {
        eventType,
        payload: {
          co_host_discord_id: coHostId || null,
          co_host_username: members.find((m) => m.discord_id === coHostId)?.username || null,
          rating: rating ? Number(rating) : null,
          screenshot_urls: screenshotUrls,
        },
      });
      setCoHostId("");
      setRating("");
      setScreenshotUrls([]);
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
      await api.decideEventActivityReport(token, reportId, { status });
      showToast(status === "approved" ? "Отчёт одобрен" : "Отчёт отклонён");
      loadReports();
    } catch (e) {
      showToast(e.message, "error");
    }
  }

  if (!access?.is_event_submitter) return null;

  return (
    <>
      <h3>Отчёты о мероприятиях</h3>
      <p className="hint-text">
        Мини-ивент или Боевой вылет — при создании форума на самом ивенте обязательно указывайте соответствующий
        тег. Локальные ивенты, повлиявшие на сюжет боевого вылета, тоже считаются Мини-ивентом.
      </p>
      {error && <p className="error-text">{error}</p>}

      <form className="report-form fade-in-up" onSubmit={handleSubmit}>
        <label>
          Тип ивента
          <select value={eventType} onChange={(e) => setEventType(e.target.value)}>
            <option value="mini">Мини-ивент</option>
            <option value="combat">Боевой вылет</option>
          </select>
        </label>
        <label>
          Помогал проводить (если был)
          <MemberSearchPicker members={members} selectedId={coHostId} onSelect={setCoHostId} />
        </label>
        <label>
          Оценка за ивент (1-10, можно дробную)
          <input
            type="number"
            min={1}
            max={10}
            step={0.1}
            value={rating}
            onChange={(e) => setRating(e.target.value)}
          />
        </label>
        <label>
          Скриншоты с ивента (минимум пара)
          <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleAttachmentUpload} />
        </label>
        {screenshotUrls.length > 0 && (
          <ul className="chip-list">
            {screenshotUrls.map((url) => (
              <li key={url} className="chip">
                <a href={url} target="_blank" rel="noreferrer">скриншот</a>
                <button type="button" onClick={() => removeScreenshot(url)}>×</button>
              </li>
            ))}
          </ul>
        )}
        <div className="report-form-actions">
          <button className="primary" type="submit" disabled={submitting || uploading}>
            Отправить
          </button>
        </div>
      </form>

      {reports.length === 0 ? (
        <EmptyState text="Отчётов пока нет." />
      ) : (
        <div className="report-list">
          {reports.map((r) => (
            <div key={r.id} className="report-row">
              <span className={`status-badge status-${r.status}`}>{STATUS_LABELS[r.status] || r.status}</span>
              <span className="report-category">{TYPE_LABELS[r.event_type] || r.event_type}</span>
              <span className="member-report-date">{formatMskDate(r.created_at)} МСК</span>
              <p className="report-byline">Провёл: {r.submitted_by?.nickname_override || r.submitted_by?.username}</p>
              {r.payload.co_host_username && <p className="report-byline">Помогал: {r.payload.co_host_username}</p>}
              {r.payload.rating != null && <p className="hint-text">Оценка: {r.payload.rating}</p>}
              {(r.payload.screenshot_urls || []).length > 0 && (
                <div className="report-images">
                  {r.payload.screenshot_urls.map((url) => (
                    <a key={url} href={url} target="_blank" rel="noreferrer" className="report-image-thumb">
                      <img src={url} alt="" />
                    </a>
                  ))}
                </div>
              )}
              {r.status === "rejected" && r.rejection_reason && (
                <p className="report-rejection-reason">Причина отклонения: {r.rejection_reason}</p>
              )}
              {r.status === "pending" && access?.can_decide_event && (
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
        <EmptyState text="Состав Ивентрума не настроен или пуст." />
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
    </>
  );
}
