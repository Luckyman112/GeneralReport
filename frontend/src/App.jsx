import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { InactiveBlock } from "./components/InactiveBlock";
import { Navbar } from "./components/Navbar";
import { PromotionBanner } from "./components/PromotionBanner";
import { RegistrationGate } from "./components/RegistrationGate";
import { ToastProvider } from "./components/ToastContext";
import { ViewAsBar } from "./components/ViewAsBar";
import { AdminPanelPage } from "./pages/AdminPanelPage";
import { BackupsPage } from "./pages/BackupsPage";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { PromotionsPage } from "./pages/PromotionsPage";
import { RegistrationsPage } from "./pages/RegistrationsPage";
import { ReportsPage } from "./pages/ReportsPage";
import { RegimentsAdminPage } from "./pages/RegimentsAdminPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ViolationsPage } from "./pages/ViolationsPage";

function Layout({ children }) {
  const { isAuthenticated, user, access } = useAuth();
  const needsRegistration =
    isAuthenticated && user?.registration_status !== "approved" && !access?.is_admin && !access?.is_high_command;
  return (
    <>
      {isAuthenticated && <PromotionBanner />}
      {isAuthenticated && <Navbar />}
      {isAuthenticated && <ViewAsBar />}
      <main className="page-container">
        {isAuthenticated && user?.is_inactive ? (
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
