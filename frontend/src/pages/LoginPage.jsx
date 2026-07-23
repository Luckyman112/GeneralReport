import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export function LoginPage() {
  const { isAuthenticated, login, loginWithPassword, error } = useAuth();
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  if (isAuthenticated) return <Navigate to="/reports" replace />;

  async function handlePasswordLogin(e) {
    e.preventDefault();
    if (!password) return;
    setSubmitting(true);
    setPasswordError(null);
    try {
      await loginWithPassword(password);
    } catch (err) {
      setPasswordError(err.message || "Не удалось войти");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-page">
      <h1>COLLAPSAR Report System</h1>
      <p>Система рапортов боевых формирований</p>
      {error && <p className="error-text">{error}</p>}
      <button className="discord-login-button" onClick={login}>
        Войти через Discord
      </button>

      <form className="password-login-form" onSubmit={handlePasswordLogin}>
        <input
          type="password"
          placeholder="Пароль администратора"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button type="submit" disabled={submitting}>
          Войти по паролю
        </button>
        {passwordError && <p className="error-text">{passwordError}</p>}
      </form>
    </div>
  );
}
