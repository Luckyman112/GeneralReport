import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { ReportForm } from "../components/ReportForm";
import { ReportRow } from "../components/ReportRow";

const STATUS_OPTIONS = [
  { value: "", label: "Все статусы" },
  { value: "draft", label: "Черновик" },
  { value: "submitted", label: "Отправлен" },
  { value: "approved", label: "Одобрен" },
  { value: "rejected", label: "Отклонён" },
  { value: "deleted", label: "Удалён" },
];

export function ReportsPage() {
  const { token, user, access } = useAuth();
  const [regiments, setRegiments] = useState([]);
  const [reports, setReports] = useState([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [regimentFilter, setRegimentFilter] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const regimentsById = useMemo(() => Object.fromEntries(regiments.map((r) => [r.id, r])), [regiments]);

  const accessibleRegimentIds = useMemo(() => {
    if (access?.is_admin) return regiments.map((r) => r.id);
    return [...new Set([...(access?.commander_regiment_ids || []), ...(access?.soldier_regiment_ids || [])])];
  }, [access, regiments]);

  const creatableRegiments = useMemo(
    () => (access?.is_admin ? regiments : regiments.filter((r) => accessibleRegimentIds.includes(r.id))),
    [regiments, access, accessibleRegimentIds]
  );

  const loadReports = useCallback(async () => {
    try {
      const data = await api.listReports(token, {
        status: statusFilter || undefined,
        regimentId: regimentFilter || undefined,
      });
      setReports(data);
    } catch (e) {
      setError(e.message);
    }
  }, [token, statusFilter, regimentFilter]);

  useEffect(() => {
    async function init() {
      setLoading(true);
      try {
        const regimentsData = await api.listRegiments(token);
        setRegiments(regimentsData);
        await loadReports();
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  function canManage(report) {
    return access?.is_admin || (access?.commander_regiment_ids || []).includes(report.regiment_id);
  }

  async function handleCreate({ regimentId, content, submit }) {
    await api.createReport(token, { regimentId, content, submit });
    setShowForm(false);
    await loadReports();
  }

  async function handleSubmitDraft(reportId) {
    await api.updateReportStatus(token, reportId, { status: "submitted" });
    await loadReports();
  }

  async function handleApprove(reportId) {
    await api.updateReportStatus(token, reportId, { status: "approved" });
    await loadReports();
  }

  async function handleReject(reportId, reason) {
    await api.updateReportStatus(token, reportId, { status: "rejected", rejectionReason: reason });
    await loadReports();
  }

  async function handleDelete(reportId) {
    await api.deleteReport(token, reportId);
    await loadReports();
  }

  if (loading) return <div className="page-loading">Загрузка...</div>;

  return (
    <div className="reports-page">
      <div className="reports-toolbar">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        {accessibleRegimentIds.length > 1 && (
          <select value={regimentFilter} onChange={(e) => setRegimentFilter(e.target.value)}>
            <option value="">Все формирования</option>
            {regiments
              .filter((r) => accessibleRegimentIds.includes(r.id))
              .map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
          </select>
        )}

        {creatableRegiments.length > 0 && !showForm && (
          <button className="primary" onClick={() => setShowForm(true)}>
            Создать рапорт
          </button>
        )}
      </div>

      {error && <p className="error-text">{error}</p>}

      {showForm && (
        <ReportForm regiments={creatableRegiments} onSubmit={handleCreate} onCancel={() => setShowForm(false)} />
      )}

      {reports.length === 0 ? (
        <p className="empty-state">Рапортов пока нет.</p>
      ) : (
        <div className="report-list">
          {reports.map((report) => (
            <ReportRow
              key={report.id}
              report={report}
              regimentName={regimentsById[report.regiment_id]?.name || `#${report.regiment_id}`}
              isOwn={report.user_id === user?.id}
              canManage={canManage(report)}
              onSubmitDraft={() => handleSubmitDraft(report.id)}
              onApprove={() => handleApprove(report.id)}
              onReject={(reason) => handleReject(report.id, reason)}
              onDelete={() => handleDelete(report.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
