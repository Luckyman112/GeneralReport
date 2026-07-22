import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export function LoginPage() {
  const { isAuthenticated, login, error } = useAuth();

  if (isAuthenticated) return <Navigate to="/reports" replace />;

  return (
    <div className="login-page">
      <h1>COLLAPSAR Report System</h1>
      <p>Система рапортов боевых формирований</p>
      {error && <p className="error-text">{error}</p>}
      <button className="discord-login-button" onClick={login}>
        Войти через Discord
      </button>
    </div>
  );
}
