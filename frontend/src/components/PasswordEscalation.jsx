import { useState } from "react";
import { useAuth } from "../auth/AuthContext";

/** Позволяет уже вошедшему через Discord человеку "повысить" текущую сессию до
 * "Локального администратора" паролем — используется вместе с двухфакторной
 * защитой (app_settings.password_login_authorized_discord_id): бэкенд примет
 * пароль только если он пришёл вместе с действующей сессией авторизованного
 * Discord-аккаунта (см. app/api/auth.py::login_via_password). */
export function PasswordEscalation() {
  const { loginWithPassword } = useAuth();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!password) return;
    setSubmitting(true);
    setError(null);
    try {
      await loginWithPassword(password);
      setOpen(false);
      setPassword("");
    } catch (err) {
      setError(err.message || "Не удалось войти");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="ghost" title="Войти как локальный администратор" onClick={() => setOpen(true)}>
        Локальный админ
      </button>
    );
  }

  return (
    <form className="password-escalation-form" onSubmit={handleSubmit}>
      <input
        type="password"
        placeholder="Пароль администратора"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoFocus
      />
      <button type="submit" disabled={submitting}>
        Войти
      </button>
      <button type="button" className="ghost" onClick={() => setOpen(false)}>
        Отмена
      </button>
      {error && <p className="error-text">{error}</p>}
    </form>
  );
}
