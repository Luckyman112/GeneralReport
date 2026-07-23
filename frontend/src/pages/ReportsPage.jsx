import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { CategoryManagerModal } from "../components/CategoryManagerModal";
import { CategoryNav } from "../components/CategoryNav";
import { RegimentPanel } from "../components/RegimentPanel";
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
  const [categoryFilter, setCategoryFilter] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [categoriesById, setCategoriesById] = useState({});
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const regimentsById = useMemo(() => Object.fromEntries(regiments.map((r) => [r.id, r])), [regiments]);
  const categoriesList = useMemo(() => Object.values(categoriesById), [categoriesById]);

  const accessibleRegimentIds = useMemo(() => {
    if (access?.is_admin) return regiments.map((r) => r.id);
    return [...new Set([...(access?.commander_regiment_ids || []), ...(access?.soldier_regiment_ids || [])])];
  }, [access, regiments]);

  const creatableRegiments = useMemo(
    () => (access?.is_admin ? regiments : regiments.filter((r) => accessibleRegimentIds.includes(r.id))),
    [regiments, access, accessibleRegimentIds]
  );

  const manageableRegiments = useMemo(
    () => regiments.filter((r) => canManageCategories(r.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [regiments, access]
  );

  function canManageCategories(regimentId) {
    return access?.is_admin || (access?.category_manager_regiment_ids || []).includes(regimentId);
  }

  function canManageMembers(regimentId) {
    return access?.is_admin || (access?.commander_regiment_ids || []).includes(regimentId);
  }

  const loadReports = useCallback(async () => {
    try {
      const data = await api.listReports(token, {
        status: statusFilter || undefined,
        regimentId: regimentFilter || undefined,
        categoryId: categoryFilter || undefined,
      });
      setReports(data);
    } catch (e) {
      setError(e.message);
    }
  }, [token, statusFilter, regimentFilter, categoryFilter]);

  const loadCategories = useCallback(
    async (regimentsData) => {
      const categoryLists = await Promise.all(
        regimentsData.map((r) => api.listCategories(token, r.id).catch(() => []))
      );
      setCategoriesById(Object.fromEntries(categoryLists.flat().map((c) => [c.id, c])));
    },
    [token]
  );

  useEffect(() => {
    async function init() {
      setLoading(true);
      try {
        const regimentsData = await api.listRegiments(token);
        setRegiments(regimentsData);
        await loadReports();
        await loadCategories(regimentsData);
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

  async function handleCreate({ regimentId, categoryId, content, submit, images }) {
    const report = await api.createReport(token, { regimentId, categoryId, content, submit });
    for (const file of images) {
      await api.uploadReportImage(token, report.id, file);
    }
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

  async function handleSetPoints(reportId, points) {
    await api.setReportPoints(token, reportId, points);
    await loadReports();
  }

  async function handleDeleteImage(reportId, imageId) {
    await api.deleteReportImage(token, reportId, imageId);
    await loadReports();
  }

  if (loading) return <div className="page-loading">Загрузка...</div>;

  return (
    <div className="reports-page-layout">
      {categoriesList.length > 0 && (
        <CategoryNav
          categories={categoriesList}
          regimentsById={regimentsById}
          activeCategoryId={categoryFilter}
          onSelect={setCategoryFilter}
        />
      )}

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

          {manageableRegiments.length > 0 && (
            <button onClick={() => setShowCategoryManager(true)}>Категории и поля</button>
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
                regimentColor={regimentsById[report.regiment_id]?.color}
                categoryName={report.category_id ? categoriesById[report.category_id]?.name : null}
                isOwn={report.user_id === user?.id}
                canManage={canManage(report)}
                canSetPoints={canManageCategories(report.regiment_id)}
                onSubmitDraft={() => handleSubmitDraft(report.id)}
                onApprove={() => handleApprove(report.id)}
                onReject={(reason) => handleReject(report.id, reason)}
                onDelete={() => handleDelete(report.id)}
                onSetPoints={(points) => handleSetPoints(report.id, points)}
                onDeleteImage={(imageId) => handleDeleteImage(report.id, imageId)}
              />
            ))}
          </div>
        )}
      </div>

      {accessibleRegimentIds.length > 0 && (
        <aside className="reports-sidebar">
          <RegimentPanel
            regiments={regiments.filter((r) => accessibleRegimentIds.includes(r.id))}
            canManageMembers={canManageMembers}
          />
        </aside>
      )}

      {showCategoryManager && (
        <CategoryManagerModal
          regiments={manageableRegiments}
          onClose={() => {
            setShowCategoryManager(false);
            loadCategories(regiments);
          }}
        />
      )}
    </div>
  );
}
