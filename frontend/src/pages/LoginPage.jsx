import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { InfoIcon, MoonIcon, SunIcon } from "../components/icons";
import { useTheme } from "../hooks/useTheme";

const DISCORD_INVITE_URL = "https://discord.gg/sM9HWDuwTd";

export function LoginPage() {
  const { isAuthenticated, login, error } = useAuth();
  const [theme, toggleTheme] = useTheme();

  if (isAuthenticated) return <Navigate to="/main" replace />;

  return (
    <div className="login-page">
      <button
        type="button"
        className="ghost login-theme-toggle"
        title={theme === "dark" ? "Светлая тема" : "Тёмная тема"}
        onClick={toggleTheme}
      >
        {theme === "dark" ? <SunIcon /> : <MoonIcon />}
      </button>
      <h1>COLLAPSAR Report System</h1>
      <p>Система рапортов боевых формирований</p>
      {error && <p className="error-text">{error}</p>}
      <a
        className="login-discord-hint"
        href={DISCORD_INVITE_URL}
        target="_blank"
        rel="noreferrer"
      >
        <InfoIcon /> Discord сервера — перед заходом запросите роль в данном Discord
      </a>
      <button className="discord-login-button" onClick={login}>
        Войти через Discord
      </button>
    </div>
  );
}
