import { lazy, Suspense } from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { InactiveBlock } from "./components/InactiveBlock";
import { MaintenanceBanner, MaintenanceBlock, useMaintenanceStatus } from "./components/MaintenanceGate";
import { Navbar } from "./components/Navbar";
import { PageLoading } from "./components/PageLoading";
import { PromotionBanner } from "./components/PromotionBanner";
import { RegistrationGate } from "./components/RegistrationGate";
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
const RegimentsAdminPage = lazy(() =>
  import("./pages/RegimentsAdminPage").then((m) => ({ default: m.RegimentsAdminPage }))
);
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const ViolationsPage = lazy(() => import("./pages/ViolationsPage").then((m) => ({ default: m.ViolationsPage })));

function Layout({ children }) {
  const { isAuthenticated, user, access } = useAuth();
  const maintenanceStatus = useMaintenanceStatus();
  const needsRegistration =
    isAuthenticated && user?.registration_status !== "approved" && !access?.is_admin && !access?.is_high_command;
  const isBlockedByMaintenance =
    isAuthenticated && maintenanceStatus?.enabled && !access?.is_admin && !access?.is_high_command;
  return (
    <>
      {isAuthenticated && access?.is_admin && <MaintenanceBanner status={maintenanceStatus} />}
      {isAuthenticated && <PromotionBanner />}
      {isAuthenticated && <Navbar />}
      {isAuthenticated && <ViewAsBar />}
      <main className="page-container">
        {isBlockedByMaintenance ? (
          <MaintenanceBlock status={maintenanceStatus} />
        ) : isAuthenticated && user?.is_inactive ? (
          <InactiveBlock />
        ) : needsRegistration ? (
          <RegistrationGate />
        ) : (
          children
        )}
      </main>
    </>
  );
}

function AppRoutes() {
  const { loading, error } = useAuth();

  if (loading) {
    return (
      <div className="page-loading">
        {error ? <p className="error-text">{error}</p> : "Выполняется вход..."}
      </div>
    );
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
            <ProtectedRoute passwordOnly>
              <SettingsPage />
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
          path="/registrations"
          element={
            <ProtectedRoute reviewerOnly>
              <RegistrationsPage />
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
