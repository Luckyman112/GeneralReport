import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthContext";

export function ProtectedRoute({ children, adminOnly = false }) {
  const { isAuthenticated, access, loading } = useAuth();

  if (loading) return <div className="page-loading">Загрузка...</div>;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (adminOnly && !access?.is_admin) return <Navigate to="/reports" replace />;

  return children;
}
