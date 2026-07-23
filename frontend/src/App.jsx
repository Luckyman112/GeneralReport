import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { InactiveBlock } from "./components/InactiveBlock";
import { Navbar } from "./components/Navbar";
import { LoginPage } from "./pages/LoginPage";
import { ReportsPage } from "./pages/ReportsPage";
import { RegimentsAdminPage } from "./pages/RegimentsAdminPage";
import { SettingsPage } from "./pages/SettingsPage";

function Layout({ children }) {
  const { isAuthenticated, user } = useAuth();
  return (
    <>
      {isAuthenticated && <Navbar />}
      <main className="page-container">
        {isAuthenticated && user?.is_inactive ? <InactiveBlock /> : children}
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
          path="/reports"
          element={
            <ProtectedRoute>
              <ReportsPage />
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
          path="/settings"
          element={
            <ProtectedRoute passwordOnly>
              <SettingsPage />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/reports" replace />} />
      </Routes>
    </Layout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <AppRoutes />
      </HashRouter>
    </AuthProvider>
  );
}
