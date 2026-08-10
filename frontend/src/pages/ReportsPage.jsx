import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { CategoryManagerModal } from "../components/CategoryManagerModal";
import { CategoryNav } from "../components/CategoryNav";
import { DetentionReportForm } from "../components/DetentionReportForm";
import { EmptyState } from "../components/EmptyState";
import { HqLeadershipPanel } from "../components/HqLeadershipPanel";
import { JediTrialReportForm } from "../components/JediTrialReportForm";
import { OverflowMenu } from "../components/OverflowMenu";
import { PageLoading } from "../components/PageLoading";
import { RecruitPromotionReportForm } from "../components/RecruitPromotionReportForm";
import { RegimentPanel } from "../components/RegimentPanel";
import { ReportForm } from "../components/ReportForm";
import { ReportRow } from "../components/ReportRow";
import { useToast } from "../components/ToastContext";
import { useLiveEvents } from "../hooks/useLiveEvents";
import { LeaveRequestsPage } from "./LeaveRequestsPage";
import { ReprimandsPage } from "./ReprimandsPage";

// SSE (см. useLiveEvents) обновляет мгновенно — поллинг оставлен редким запасным
// вариантом на случай обрыва соединения
const REPORTS_POLL_INTERVAL_MS = 60000;
const REPORTS_PAGE_SIZE = 50;

const STATUS_OPTIONS = [
  { value: "", label: "Все статусы" },
  { value: "draft", label: "Черновик" },
  { value: "submitted", label: "Отправлен" },
  { value: "approved", label: "Одобрен" },
  { value: "rejected", label: "Отклонён" },
  { value: "deleted", label: "Удалён" },
];

const PERIOD_OPTIONS = [
  { value: "day", label: "За день" },
  { value: "week", label: "За неделю" },
  { value: "month", label: "За месяц" },
  { value: "all", label: "Всё время" },
];

export function ReportsPage() {
  const { token, user, access, regiments: allRegiments } = useAuth();
  const showToast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [regiments, setRegiments] = useState([]);
  const [reports, setReports] = useState([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [periodFilter, setPeriodFilter] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [regimentFilter, setRegimentFilter] = useState(searchParams.get("regiment") || "");
  const [categoryFilter, setCategoryFilter] = useState(searchParams.get("category") || null);
  const [focusMemberRegimentId] = useState(searchParams.get("member") ? searchParams.get("regiment") : null);
  const [focusMemberDiscordId] = useState(searchParams.get("member") || null);
  const [view, setView] = useState("reports"); // "reports" | "reprimands" | "leave"
  const [showForm, setShowForm] = useState(false);
  const [showDetentionForm, setShowDetentionForm] = useState(false);
  const [showRecruitForm, setShowRecruitForm] = useState(false);
  const [showJediTrialForm, setShowJediTrialForm] = useState(false);
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [categoriesById, setCategoriesById] = useState({});
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const regimentsById = useMemo(() => Object.fromEntries(regiments.map((r) => [r.id, r])), [regiments]);
  const hqRegiment = useMemo(() => regiments.find((r) => r.name === "Штаб"), [regiments]);
  const isViewingHq = Boolean(hqRegiment && Number(regimentFilter) === hqRegiment.id);

  const accessibleRegimentIds = useMemo(() => {
    if (access?.is_admin || access?.is_high_command) return regiments.map((r) => r.id);
    const ids = new Set([...(access?.commander_regiment_ids || []), ...(access?.soldier_regiment_ids || [])]);
    // командир/зам ЛЮБОГО формирования видит Штаб — там могут быть категории
    // "открытые командирам всех формирований" (open_to_regiment_leadership),
    // даже если сам он в Штабе не состоит
    if (access?.is_regiment_leadership) {
      const hq = regiments.find((r) => r.name === "Штаб");
      if (hq) ids.add(hq.id);
    }
    return [...ids];
  }, [access, regiments]);

  // only regiments the user can actually access, else nav shows categories they can't see;
  // when regimentFilter is set (напр. по ссылке "Штаб"), сужаем список категорий до одного
  // формирования — иначе категории Штаба тонут среди категорий остальных формирований
  const categoriesList = useMemo(
    () =>
      Object.values(categoriesById).filter(
        (c) => accessibleRegimentIds.includes(c.regiment_id) && (!regimentFilter || c.regiment_id === Number(regimentFilter))
      ),
    [categoriesById, accessibleRegimentIds, regimentFilter]
  );
  // promotion/demotion are system mirror categories, shown next to Reprimands/Leave instead
  const regularCategoriesList = useMemo(
    () => categoriesList.filter((c) => !c.is_promotion && !c.is_demotion && !c.is_training),
    [categoriesList]
  );
  const promotionCategories = useMemo(() => categoriesList.filter((c) => c.is_promotion), [categoriesList]);
  const demotionCategories = useMemo(() => categoriesList.filter((c) => c.is_demotion), [categoriesList]);
  const trainingCategories = useMemo(() => categoriesList.filter((c) => c.is_training), [categoriesList]);

  const creatableRegiments = useMemo(() => {
    const base = access?.is_admin || access?.is_high_command ? regiments : regiments.filter((r) => accessibleRegimentIds.includes(r.id));
    return regimentFilter ? base.filter((r) => r.id === Number(regimentFilter)) : base;
  }, [regiments, access, accessibleRegimentIds, regimentFilter]);

  // Конструктор категорий теперь доступен только высшему командованию/админу — и
  // сразу для всех формирований, не привязан к конкретному
  const manageableRegiments = access?.can_manage_categories ? regiments : [];

  function canSetPoints(report) {
    if (access?.is_admin || access?.is_high_command) return true;
    if (categoriesById[report.category_id]?.is_training) return Boolean(access?.can_grant_specializations);
    return (access?.category_manager_regiment_ids || []).includes(report.regiment_id);
  }

  function canManageMembers(regimentId) {
    return access?.is_admin || access?.is_high_command || (access?.commander_regiment_ids || []).includes(regimentId);
  }

  const [totalReportsCount, setTotalReportsCount] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // debounce search input
  useEffect(() => {
    const timeout = setTimeout(() => setSearchQuery(searchInput.trim()), 350);
    return () => clearTimeout(timeout);
  }, [searchInput]);

  // Растёт при каждом ПОЛНОМ перезаборе списка (loadReports) — "Показать ещё"
  // сверяется с этим значением после своего ответа: если полный перезабор успел
  // произойти, пока грузилась следующая страница (live-событие/поллинг), offset
  // из уже неактуального снимка reports.length больше не соответствует текущему
  // списку — доклеивать его нельзя, получится дыра/дубли.
  const reportsGenerationRef = useRef(0);

  const loadReports = useCallback(async () => {
    const generation = ++reportsGenerationRef.current;
    try {
      const { data, total } = await api.listReports(token, {
        status: statusFilter || undefined,
        regimentId: regimentFilter || undefined,
        categoryId: categoryFilter || undefined,
        search: searchQuery || undefined,
        period: periodFilter !== "all" ? periodFilter : undefined,
        limit: REPORTS_PAGE_SIZE,
        offset: 0,
      });
      if (generation !== reportsGenerationRef.current) return; // обогнан более новым перезабором
      setReports(data);
      setTotalReportsCount(total);
    } catch (e) {
      setError(e.message);
    }
  }, [token, statusFilter, regimentFilter, categoryFilter, searchQuery, periodFilter]);

  async function loadMoreReports() {
    const generation = reportsGenerationRef.current;
    setLoadingMore(true);
    try {
      const { data, total } = await api.listReports(token, {
        status: statusFilter || undefined,
        regimentId: regimentFilter || undefined,
        categoryId: categoryFilter || undefined,
        search: searchQuery || undefined,
        period: periodFilter !== "all" ? periodFilter : undefined,
        limit: REPORTS_PAGE_SIZE,
        offset: reports.length,
      });
      if (generation !== reportsGenerationRef.current) return; // список уже перезагружен целиком
      setReports((prev) => [...prev, ...data]);
      setTotalReportsCount(total);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingMore(false);
    }
  }

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

  useLiveEvents("reports", loadReports);

  // Первый вызов loadReports на монтировании уже делает init() выше — не дублируем
  // тот же запрос; при последующих сменах loadReports (фильтры/поиск) грузим сразу,
  // как и раньше, плюс держим редкий запасной поллинг на случай обрыва SSE.
  const isFirstPollRunRef = useRef(true);
  useEffect(() => {
    if (isFirstPollRunRef.current) {
      isFirstPollRunRef.current = false;
    } else {
      loadReports();
    }
    const interval = setInterval(loadReports, REPORTS_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [loadReports]);

  useEffect(() => {
    if (searchParams.get("regiment") || searchParams.get("category") || searchParams.get("member")) {
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function canManage(report) {
    // promotion/demotion mirror records aren't managed here
    if (categoriesById[report.category_id]?.is_promotion || categoriesById[report.category_id]?.is_demotion) return false;
    return (
      access?.is_admin ||
      access?.is_high_command ||
      (access?.commander_regiment_ids || []).includes(report.regiment_id) ||
      (access?.report_appeal_regiment_ids || []).includes(report.regiment_id)
    );
  }

  function canDelete(report) {
    if (report.user_id === user?.id && report.status === "draft") return true;
    if (!canManage(report)) return false;
    // Аннулировать рапорт о задержании может только администратор
    if (categoriesById[report.category_id]?.is_detention) return Boolean(access?.is_admin);
    return true;
  }

  function canReject(report) {
    const category = categoriesById[report.category_id];
    // promotion/demotion mirror records aren't managed here — same exclusion as
    // canManage, applies even to the report_reject_role_ids/_user_discord_ids override
    if (category?.is_promotion || category?.is_demotion) return false;
    // отдельная привилегия "отклонить любой рапорт" — не связана с командованием
    // формированием (см. access.can_reject_any_report на бэкенде)
    if (!canManage(report) && !access?.can_reject_any_report) return false;
    // only someone who can grant specializations (or the override) can reject a training report
    if (category?.is_training) {
      return Boolean(
        access?.is_admin || access?.is_high_command || access?.can_grant_specializations || access?.can_reject_any_report
      );
    }
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

  async function handleCreateRecruitPromotion(payload) {
    await api.createReport(token, { ...payload, submit: true });
    setShowRecruitForm(false);
    await loadReports();
  }

  async function handleCreateJediTrial(payload) {
    await api.createReport(token, { ...payload, submit: true });
    setShowJediTrialForm(false);
    await loadReports();
  }

  async function handleSubmitDraft(reportId) {
    try {
      await api.updateReportStatus(token, reportId, { status: "submitted" });
      await loadReports();
    } catch (e) {
      showToast(e.message, "error");
    }
  }

  async function handleEditContent(reportId, content) {
    try {
      await api.updateReportContent(token, reportId, content);
      await loadReports();
    } catch (e) {
      showToast(e.message, "error");
    }
  }

  async function handleApprove(reportId) {
    try {
      await api.updateReportStatus(token, reportId, { status: "approved" });
      await loadReports();
    } catch (e) {
      showToast(e.message, "error");
    }
  }

  async function handleReject(reportId, reason) {
    try {
      await api.updateReportStatus(token, reportId, { status: "rejected", rejectionReason: reason });
      await loadReports();
    } catch (e) {
      showToast(e.message, "error");
    }
  }

  // Совместные категории (см. ReportCategory.is_joint) — какими формированиями
  // из участников этого рапорта может распоряжаться сам зритель
  function decidableRegimentIds(report) {
    if (!report.regiment_decisions?.length) return [];
    if (access?.is_admin || access?.is_high_command) return report.regiment_decisions.map((d) => d.regiment_id);
    const commanderIds = access?.commander_regiment_ids || [];
    return report.regiment_decisions.map((d) => d.regiment_id).filter((id) => commanderIds.includes(id));
  }

  async function handleDecideRegiment(reportId, regimentId, status, reason) {
    try {
      await api.decideReportForRegiment(token, reportId, regimentId, { status, rejectionReason: reason });
      await loadReports();
    } catch (e) {
      showToast(e.message, "error");
    }
  }

  async function handleDelete(reportId) {
    try {
      await api.deleteReport(token, reportId);
      await loadReports();
    } catch (e) {
      showToast(e.message, "error");
    }
  }

  async function handleSetPoints(reportId, points) {
    try {
      await api.setReportPoints(token, reportId, points);
      await loadReports();
    } catch (e) {
      showToast(e.message, "error");
    }
  }

  async function handleDeleteImage(reportId, imageId) {
    try {
      await api.deleteReportImage(token, reportId, imageId);
      await loadReports();
    } catch (e) {
      showToast(e.message, "error");
    }
  }

  if (loading) return <PageLoading />;

  function handleSelectView(newView, categoryId = null) {
    setView(newView);
    if (newView === "reports") setCategoryFilter(categoryId);
  }

  return (
    <div className="reports-page-layout">
      <CategoryNav
        categories={regularCategoriesList}
        promotionCategories={promotionCategories}
        demotionCategories={demotionCategories}
        trainingCategories={trainingCategories}
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
          <div className="reports-toolbar reports-toolbar-filters">
            <input
              type="text"
              className="reports-search-input"
              placeholder="Поиск по тексту рапорта..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
            />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <select value={periodFilter} onChange={(e) => setPeriodFilter(e.target.value)}>
              {PERIOD_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>

            {accessibleRegimentIds.length > 1 && (
              <label className="violation-filter-label">
                Фильтр рапортов
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
              </label>
            )}
          </div>

          <div className="reports-toolbar reports-toolbar-actions">
            {creatableRegiments.length > 0 && !showForm && (
              <button className="primary" onClick={() => setShowForm(true)}>
                Создать рапорт
              </button>
            )}

            <OverflowMenu
              items={[
                access?.can_file_detention_report &&
                  !showDetentionForm && {
                    label: "Рапорт о задержании",
                    danger: true,
                    onClick: () => setShowDetentionForm(true),
                  },
                !showRecruitForm && {
                  label: "Курс молодого бойца",
                  onClick: () => setShowRecruitForm(true),
                },
                !showJediTrialForm && {
                  label: "Наставничество",
                  onClick: () => setShowJediTrialForm(true),
                },
                manageableRegiments.length > 0 && {
                  label: "Категории и поля",
                  onClick: () => setShowCategoryManager(true),
                },
              ]}
            />
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

          {showRecruitForm && (
            <RecruitPromotionReportForm
              categoriesById={categoriesById}
              onSubmit={handleCreateRecruitPromotion}
              onCancel={() => setShowRecruitForm(false)}
            />
          )}

          {showJediTrialForm && (
            <JediTrialReportForm
              categoriesById={categoriesById}
              onSubmit={handleCreateJediTrial}
              onCancel={() => setShowJediTrialForm(false)}
            />
          )}

          {reports.length === 0 ? (
            <EmptyState text="Рапортов пока нет." />
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
                  canReject={canReject(report)}
                  canSetPoints={canSetPoints(report)}
                  decidableRegimentIds={decidableRegimentIds(report)}
                  onSubmitDraft={() => handleSubmitDraft(report.id)}
                  onApprove={() => handleApprove(report.id)}
                  onReject={(reason) => handleReject(report.id, reason)}
                  onDecideRegiment={(regimentId, status, reason) =>
                    handleDecideRegiment(report.id, regimentId, status, reason)
                  }
                  onEditContent={(content) => handleEditContent(report.id, content)}
                  onDelete={() => handleDelete(report.id)}
                  onSetPoints={(points) => handleSetPoints(report.id, points)}
                  onDeleteImage={(imageId) => handleDeleteImage(report.id, imageId)}
                />
              ))}
            </div>
          )}

          {totalReportsCount != null && reports.length < totalReportsCount && (
            <div className="reports-load-more">
              <button className="ghost" onClick={loadMoreReports} disabled={loadingMore}>
                {loadingMore ? "Загрузка..." : `Показать ещё (${totalReportsCount - reports.length})`}
              </button>
            </div>
          )}
        </div>
      )}

      {isViewingHq ? (
        <aside className="reports-sidebar">
          <HqLeadershipPanel />
        </aside>
      ) : (
        accessibleRegimentIds.length > 0 && (
          <aside className="reports-sidebar">
            <RegimentPanel
              regiments={regiments.filter((r) => accessibleRegimentIds.includes(r.id))}
              canManageMembers={canManageMembers}
              initialRegimentId={focusMemberRegimentId ? Number(focusMemberRegimentId) : undefined}
              focusDiscordId={focusMemberDiscordId}
            />
          </aside>
        )
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
