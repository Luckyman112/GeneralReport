import { Navigate } from "react-router-dom";
import { PageLoading } from "../components/PageLoading";
import { useAuth } from "./AuthContext";

export function ProtectedRoute({
  children,
  adminOnly = false,
  passwordOnly = false,
  reviewerOnly = false,
  disciplineDeputyOnly = false,
  eventRoomOnly = false,
  adminStaffOnly = false,
}) {
  const { isAuthenticated, access, loading } = useAuth();

  if (loading) return <PageLoading />;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (adminOnly && !access?.is_admin) return <Navigate to="/main" replace />;
  if (passwordOnly && !access?.is_password_login) return <Navigate to="/main" replace />;
  if (
    disciplineDeputyOnly &&
    !access?.is_admin &&
    (access?.deputy_disciplines || []).length === 0
  )
    return <Navigate to="/main" replace />;
  if (eventRoomOnly && !access?.can_access_event_room) return <Navigate to="/main" replace />;
  if (adminStaffOnly && !access?.is_admin_staff && !access?.is_admin) return <Navigate to="/main" replace />;
  if (
    reviewerOnly &&
    !access?.is_admin &&
    !access?.is_high_command &&
    (access?.commander_regiment_ids || []).length === 0
  )
    return <Navigate to="/main" replace />;

  return children;
}
