import { lazy, Suspense, useEffect, useState } from "react";
import { HashRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { BootScreen } from "./components/BootScreen";
import { InactiveBlock } from "./components/InactiveBlock";
import { MaintenanceBanner, MaintenanceBlock, useMaintenanceStatus } from "./components/MaintenanceGate";
import { Navbar } from "./components/Navbar";
import { PageLoading } from "./components/PageLoading";
import { PromotionBanner } from "./components/PromotionBanner";
import { RegistrationGate } from "./components/RegistrationGate";
import { RoleConflictGate } from "./components/RoleConflictGate";
import { Sidebar } from "./components/Sidebar";
import { TransferFrozenGate } from "./components/TransferFrozenGate";
import { ToastProvider } from "./components/ToastContext";
import { ViewAsBar } from "./components/ViewAsBar";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { ReportsPage } from "./pages/ReportsPage";

// Реже посещаемые/административные страницы — code-splitting по роутам, чтобы
// обычный боец не тянул код админ-панели/бэкапов/настроек при каждой загрузке.
const AdminPanelPage = lazy(() => import("./pages/AdminPanelPage").then((m) => ({ default: m.AdminPanelPage })));
const BackupsPage = lazy(() => import("./pages/BackupsPage").then((m) => ({ default: m.BackupsPage })));
const PromotionsPage = lazy(() => import("./pages/PromotionsPage").then((m) => ({ default: m.PromotionsPage })));
const RegistrationsPage = lazy(() =>
  import("./pages/RegistrationsPage").then((m) => ({ default: m.RegistrationsPage }))
);
const TransferRequestsPage = lazy(() =>
  import("./pages/TransferRequestsPage").then((m) => ({ default: m.TransferRequestsPage }))
);
const RegimentsAdminPage = lazy(() =>
  import("./pages/RegimentsAdminPage").then((m) => ({ default: m.RegimentsAdminPage }))
);
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const LogsPage = lazy(() => import("./pages/LogsPage").then((m) => ({ default: m.LogsPage })));
const ViolationsPage = lazy(() => import("./pages/ViolationsPage").then((m) => ({ default: m.ViolationsPage })));
const InstructorRoomPage = lazy(() =>
  import("./pages/InstructorRoomPage").then((m) => ({ default: m.InstructorRoomPage }))
);
const DisciplinePage = lazy(() => import("./pages/DisciplinePage").then((m) => ({ default: m.DisciplinePage })));
const DisciplineRosterPage = lazy(() =>
  import("./pages/DisciplineRosterPage").then((m) => ({ default: m.DisciplineRosterPage }))
);
const EventRoomPage = lazy(() => import("./pages/EventRoomPage").then((m) => ({ default: m.EventRoomPage })));
const RecruitsPage = lazy(() => import("./pages/RecruitsPage").then((m) => ({ default: m.RecruitsPage })));

function Layout({ children }) {
  const { isAuthenticated, user, access } = useAuth();
  const maintenanceStatus = useMaintenanceStatus();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const needsRegistration =
    isAuthenticated && user?.registration_status !== "approved" && !access?.is_admin && !access?.is_high_command;
  const isBlockedByMaintenance =
    isAuthenticated && maintenanceStatus?.enabled && !access?.is_admin && !access?.is_high_command;
  const hasRoleConflict =
    isAuthenticated && (access?.soldier_regiment_ids || []).length > 1 && !access?.is_admin && !access?.is_high_command;
  const isFrozenForTransfer = isAuthenticated && access?.active_transfer?.status === "approved";

  // Закрываем мобильный сайдбар при переходе на другой роут и блокируем скролл
  // страницы под ним, пока он открыт — та же логика, что была в старом Navbar.
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!sidebarOpen) return undefined;
    document.body.style.overflow = "hidden";
    const onKeyDown = (e) => {
      if (e.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [sidebarOpen]);

  if (!isAuthenticated) {
    // Режим обслуживания публичный — блокируем и анонимных посетителей, кроме
    // самой страницы входа, иначе админ не сможет зайти и выключить его.
    const blockedByMaintenance = maintenanceStatus?.enabled && location.pathname !== "/login";
    return (
      <>
        <main className="page-container">{blockedByMaintenance ? <MaintenanceBlock status={maintenanceStatus} /> : children}</main>
        <a
          className="made-by-credit"
          href="https://discord.com/users/417686926695333890"
          target="_blank"
          rel="noreferrer"
        >
          Сделано · Lucky
        </a>
      </>
    );
  }

  return (
    <div className="app-shell">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="app-content">
        {access?.is_admin && <MaintenanceBanner status={maintenanceStatus} />}
        <PromotionBanner />
        <Navbar onBurgerClick={() => setSidebarOpen((v) => !v)} sidebarOpen={sidebarOpen} />
        <ViewAsBar />
        <main className="page-container">
          {isBlockedByMaintenance ? (
            <MaintenanceBlock status={maintenanceStatus} />
          ) : hasRoleConflict ? (
            <RoleConflictGate />
          ) : isFrozenForTransfer ? (
            <TransferFrozenGate />
          ) : user?.is_inactive ? (
            <InactiveBlock />
          ) : needsRegistration ? (
            <RegistrationGate />
          ) : (
            children
          )}
        </main>
        <a
          className="made-by-credit"
          href="https://discord.com/users/417686926695333890"
          target="_blank"
          rel="noreferrer"
        >
          Сделано · Lucky
        </a>
      </div>
    </div>
  );
}

function AppRoutes() {
  const { loading, error } = useAuth();

  if (loading) {
    return <BootScreen error={error} />;
  }

  return (
    <Layout>
      <Suspense fallback={<PageLoading />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/main"
          element={
            <ProtectedRoute>
              <HomePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reports"
          element={
            <ProtectedRoute>
              <ReportsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/promotions"
          element={
            <ProtectedRoute>
              <PromotionsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/regiments"
          element={
            <ProtectedRoute adminOnly>
              <RegimentsAdminPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/backups"
          element={
            <ProtectedRoute adminOnly>
              <BackupsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute adminOnly>
              <SettingsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/logs"
          element={
            <ProtectedRoute disciplineDeputyOnly>
              <LogsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/discipline"
          element={
            <ProtectedRoute disciplineDeputyOnly>
              <DisciplinePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/specializations/medic"
          element={
            <ProtectedRoute>
              <DisciplineRosterPage discipline="medic" title="Медицина" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/specializations/engineer"
          element={
            <ProtectedRoute>
              <DisciplineRosterPage discipline="engineer" title="Инженерия" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/event-room"
          element={
            <ProtectedRoute eventRoomOnly>
              <EventRoomPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/recruits"
          element={
            <ProtectedRoute reviewerOnly>
              <RecruitsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/violations"
          element={
            <ProtectedRoute>
              <ViolationsPage />
            </ProtectedRoute>
          }
        />
        {/* Розыск переехал вкладкой внутрь /violations (см. решение пользователя) —
            редирект на случай старых закладок/ссылок */}
        <Route path="/wanted" element={<Navigate to="/violations" replace />} />
        <Route
          path="/instructor-room"
          element={
            <ProtectedRoute>
              <InstructorRoomPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/registrations"
          element={
            <ProtectedRoute reviewerOnly>
              <RegistrationsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/transfers"
          element={
            <ProtectedRoute reviewerOnly>
              <TransferRequestsPage />
            </ProtectedRoute>
          }
        />
        {/* Выговоры/Отпуска переехали внутрь /reports (навигация по категориям) */}
        <Route path="/reprimands" element={<Navigate to="/reports" replace />} />
        <Route path="/leave-requests" element={<Navigate to="/reports" replace />} />
        <Route
          path="/admin-panel"
          element={
            <ProtectedRoute adminOnly>
              <AdminPanelPage />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/main" replace />} />
      </Routes>
      </Suspense>
    </Layout>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <HashRouter>
          <AppRoutes />
        </HashRouter>
      </AuthProvider>
    </ToastProvider>
  );
}
