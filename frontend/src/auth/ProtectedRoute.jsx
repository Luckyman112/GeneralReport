import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthContext";

export function ProtectedRoute({ children, adminOnly = false, passwordOnly = false, violationsOnly = false }) {
  const { isAuthenticated, access, loading } = useAuth();

  if (loading) return <div className="page-loading">Загрузка...</div>;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (adminOnly && !access?.is_admin) return <Navigate to="/reports" replace />;
  if (passwordOnly && !access?.is_password_login) return <Navigate to="/reports" replace />;
  if (violationsOnly && !access?.can_view_violations) return <Navigate to="/reports" replace />;

  return children;
}
