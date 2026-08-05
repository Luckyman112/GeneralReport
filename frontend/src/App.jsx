import { lazy, Suspense } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
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

function Layout({ children }) {
  const { isAuthenticated, user, access } = useAuth();
  const maintenanceStatus = useMaintenanceStatus();
  const needsRegistration =
    isAuthenticated && user?.registration_status !== "approved" && !access?.is_admin && !access?.is_high_command;
  const isBlockedByMaintenance =
    isAuthenticated && maintenanceStatus?.enabled && !access?.is_admin && !access?.is_high_command;
  const hasRoleConflict =
    isAuthenticated && (access?.soldier_regiment_ids || []).length > 1 && !access?.is_admin && !access?.is_high_command;
  const isFrozenForTransfer = isAuthenticated && access?.active_transfer?.status === "approved";
  return (
    <>
      {isAuthenticated && access?.is_admin && <MaintenanceBanner status={maintenanceStatus} />}
      {isAuthenticated && <PromotionBanner />}
      {isAuthenticated && <Navbar />}
      {isAuthenticated && <ViewAsBar />}
      <main className="page-container">
        {isBlockedByMaintenance ? (
          <MaintenanceBlock status={maintenanceStatus} />
        ) : hasRoleConflict ? (
          <RoleConflictGate />
        ) : isFrozenForTransfer ? (
          <TransferFrozenGate />
        ) : isAuthenticated && user?.is_inactive ? (
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
    </>
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
            <ProtectedRoute adminOnly>
              <LogsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/violations"
          element={
            <ProtectedRoute violationsOnly>
              <ViolationsPage />
            </ProtectedRoute>
          }
        />
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
