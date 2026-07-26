import { Navigate } from "react-router-dom";
import { PageLoading } from "../components/PageLoading";
import { useAuth } from "./AuthContext";

export function ProtectedRoute({
  children,
  adminOnly = false,
  passwordOnly = false,
  violationsOnly = false,
  reviewerOnly = false,
}) {
  const { isAuthenticated, access, loading } = useAuth();

  if (loading) return <PageLoading />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (adminOnly && !access?.is_admin) return <Navigate to="/main" replace />;
  if (passwordOnly && !access?.is_password_login) return <Navigate to="/main" replace />;
  if (violationsOnly && !access?.can_view_violations) return <Navigate to="/main" replace />;
  if (
    reviewerOnly &&
    !access?.is_admin &&
    !access?.is_high_command &&
    (access?.commander_regiment_ids || []).length === 0
  )
    return <Navigate to="/main" replace />;

  return children;
}
