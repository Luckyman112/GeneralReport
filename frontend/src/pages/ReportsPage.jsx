import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { CategoryManagerModal } from "../components/CategoryManagerModal";
import { CategoryNav } from "../components/CategoryNav";
import { DetentionReportForm } from "../components/DetentionReportForm";
import { RegimentPanel } from "../components/RegimentPanel";
import { ReportForm } from "../components/ReportForm";
import { ReportRow } from "../components/ReportRow";
import { LeaveRequestsPage } from "./LeaveRequestsPage";
import { ReprimandsPage } from "./ReprimandsPage";

const REPORTS_POLL_INTERVAL_MS = 20000;

const STATUS_OPTIONS = [
  { value: "", label: "Все статусы" },
  { value: "draft", label: "Черновик" },
  { value: "submitted", label: "Отправлен" },
  { value: "approved", label: "Одобрен" },
  { value: "rejected", label: "Отклонён" },
  { value: "deleted", label: "Удалён" },
];

export function ReportsPage() {
  const { token, user, access, regiments: allRegiments } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [regiments, setRegiments] = useState([]);
  const [reports, setReports] = useState([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [regimentFilter, setRegimentFilter] = useState(searchParams.get("regiment") || "");
  const [categoryFilter, setCategoryFilter] = useState(searchParams.get("category") || null);
  const [view, setView] = useState("reports"); // "reports" | "reprimands" | "leave"
  const [showForm, setShowForm] = useState(false);
  const [showDetentionForm, setShowDetentionForm] = useState(false);
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [categoriesById, setCategoriesById] = useState({});
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const regimentsById = useMemo(() => Object.fromEntries(regiments.map((r) => [r.id, r])), [regiments]);
  // Категория "задержание" видна всем как обычная категория (подать рапорт этой
  // категории может только тот, у кого есть доступ, см. can_file_detention_report)
  const categoriesList = useMemo(() => Object.values(categoriesById), [categoriesById]);

  const accessibleRegimentIds = useMemo(() => {
    if (access?.is_admin || access?.is_high_command) return regiments.map((r) => r.id);
    return [...new Set([...(access?.commander_regiment_ids || []), ...(access?.soldier_regiment_ids || [])])];
  }, [access, regiments]);

  const creatableRegiments = useMemo(
    () => (access?.is_admin || access?.is_high_command ? regiments : regiments.filter((r) => accessibleRegimentIds.includes(r.id))),
    [regiments, access, accessibleRegimentIds]
  );

  // Конструктор категорий теперь доступен только высшему командованию/админу — и
  // сразу для всех формирований, не привязан к конкретному
  const manageableRegiments = access?.can_manage_categories ? regiments : [];

  function canSetPoints(regimentId) {
    return access?.is_admin || access?.is_high_command || (access?.category_manager_regiment_ids || []).includes(regimentId);
  }

  function canManageMembers(regimentId) {
    return access?.is_admin || access?.is_high_command || (access?.commander_regiment_ids || []).includes(regimentId);
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
    // Список рапортов обновляется сам по себе — не нужно перезагружать страницу,
    // чтобы увидеть чужое новое/одобренное действие
    const interval = setInterval(loadReports, REPORTS_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadReports]);

  useEffect(() => {
    if (searchParams.get("regiment") || searchParams.get("category")) {
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function canManage(report) {
    // Дубликат заявки на повышение — решение принимается на странице "Повышения",
    // здесь его одобрить/отклонить/удалить нельзя (см. app/api/reports.py)
    if (categoriesById[report.category_id]?.is_promotion) return false;
    return access?.is_admin || access?.is_high_command || (access?.commander_regiment_ids || []).includes(report.regiment_id);
  }

  function canDelete(report) {
    if (!canManage(report)) return false;
    // Аннулировать рапорт о задержании может только администратор
    if (categoriesById[report.category_id]?.is_detention) return Boolean(access?.is_admin);
    return true;
  }

  async function handleCreate({ regimentId, categoryId, content, submit, images, participantDiscordIds }) {
    const report = await api.createReport(token, { regimentId, categoryId, content, submit, participantDiscordIds });
    for (const file of images) {
      await api.uploadReportImage(token, report.id, file);
    }
    setShowForm(false);
    await loadReports();
  }

  async function handleCreateDetention({ images, ...payload }) {
    const report = await api.createReport(token, { ...payload, submit: true });
    for (const file of images) {
      await api.uploadReportImage(token, report.id, file);
    }
    setShowDetentionForm(false);
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

  function handleSelectView(newView, categoryId = null) {
    setView(newView);
    if (newView === "reports") setCategoryFilter(categoryId);
  }

  return (
    <div className="reports-page-layout">
      <CategoryNav
        categories={categoriesList}
        regimentsById={regimentsById}
        activeCategoryId={categoryFilter}
        view={view}
        onSelectView={handleSelectView}
        showReprimands={access?.can_view_violations}
        showLeave={access?.can_view_violations}
      />

      {view === "reprimands" ? (
        <ReprimandsPage />
      ) : view === "leave" ? (
        <LeaveRequestsPage />
      ) : (
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

            {access?.can_file_detention_report && !showDetentionForm && (
              <button className="danger-outline" onClick={() => setShowDetentionForm(true)}>
                Рапорт о задержании
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

          {showDetentionForm && (
            <DetentionReportForm
              regiments={creatableRegiments.length > 0 ? creatableRegiments : allRegiments}
              categoriesById={categoriesById}
              onSubmit={handleCreateDetention}
              onCancel={() => setShowDetentionForm(false)}
            />
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
                  targetRegimentName={report.target_regiment_id ? regimentsById[report.target_regiment_id]?.name : null}
                  isOwn={report.user_id === user?.id}
                  canManage={canManage(report)}
                  canDelete={canDelete(report)}
                  canSetPoints={canSetPoints(report.regiment_id)}
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
      )}

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
