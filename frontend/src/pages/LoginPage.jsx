import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

const DISCORD_INVITE_URL = "https://discord.gg/sM9HWDuwTd";

export function LoginPage() {
  const { isAuthenticated, login, error } = useAuth();
  const [apiOk, setApiOk] = useState(null); // null = ещё проверяется, потом true/false

  // Терминал входа — литеральный CRT-датапад, задуман только под тёмную
  // палитру (см. решение пользователя — светлая тема тут "ущербно" смотрится).
  // Временно перебиваем глобальный data-theme, пока страница открыта, и
  // возвращаем как было при уходе — общий выбор темы в остальном приложении
  // не трогаем.
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.getAttribute("data-theme");
    root.setAttribute("data-theme", "dark");
    return () => {
      if (previous === null) root.removeAttribute("data-theme");
      else root.setAttribute("data-theme", previous);
    };
  }, []);

  useEffect(() => {
    // 6с таймаут — без него зависший бэкенд оставляет "проверка…" навечно,
    // хотя реальный ответ уже никогда не придёт
    const timeout = new Promise((resolve) => setTimeout(() => resolve("timeout"), 6000));
    Promise.race([api.checkHealth(), timeout]).then((r) => setApiOk(r !== "timeout"));
  }, []);

  // ENTER входит через Discord с любого места на экране — реальный аналог
  // "ВВОД С КЛАВИАТУРЫ" из терминального рефренса. Игнорируем, если фокус уже
  // на кнопке/ссылке — иначе Enter на самой кнопке "Войти" вызовет login()
  // дважды (родной клик по фокусу + этот обработчик).
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key !== "Enter") return;
      const tag = e.target?.tagName;
      if (tag === "BUTTON" || tag === "A" || tag === "INPUT") return;
      login();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [login]);

  if (isAuthenticated) return <Navigate to="/main" replace />;

  return (
    <div className="login-page">
      <div className="term-shell fade-in-up">
        <div className="term-screws" aria-hidden="true">
          <i /><i /><i /><i />
        </div>
        <div className="term-top">
          <span className="term-brand">COLLAPSAR · ТЕРМИНАЛ ДОСТУПА</span>
          <span className="term-clearance">гость · аутентификация требуется</span>
        </div>

        <div className="term-rig">
          <div className="term-rail" aria-hidden="true">
            <span className="term-dot term-dot-ok" />
            <span className="term-dot term-dot-ok" />
            <span className={`term-dot ${apiOk === false ? "term-dot-warn" : "term-dot-ok"}`} />
            <span className="term-rail-tick" />
            <span className="term-dot term-dot-ok" />
            <span className="term-dot" />
            <span className="term-rail-label">питание · шина · связь</span>
          </div>

          <div className="term-bezel">
            <div className="term-crt">
              <div className="term-scr">
                <p>
                  <span className="term-hot">ПЗУ УЗЛА ВХОДА · РЕВИЗИЯ 3.0</span>
                </p>
                <p className="term-dim">Инициализация модуля авторизации …</p>
                <p>
                  Discord OAuth2 <span className="term-g">ГОТОВО</span>
                </p>
                <p>
                  Канал API{" "}
                  {apiOk === null ? (
                    <span className="term-dim">проверка…</span>
                  ) : apiOk ? (
                    <span className="term-g">НА СВЯЗИ</span>
                  ) : (
                    <span className="term-w">НЕ ОТВЕЧАЕТ</span>
                  )}
                </p>
                <p className="term-dim">──────────────────────────────────</p>
                <p>
                  <span className="term-hot">COLLAPSAR REPORT SYSTEM</span>
                </p>
                <p className="term-dim">Система рапортов боевых формирований</p>
                <p className="term-dim">──────────────────────────────────</p>
                <p className="term-dim">
                  Discord сервера — перед заходом запросите роль в данном Discord.
                </p>
                {error && <p className="term-r">{error}</p>}
                <p>
                  ДОСТУП&gt; <span className="term-cur" aria-hidden="true" />
                </p>
              </div>
              <div className="term-flicker" aria-hidden="true" />
            </div>
          </div>

          <div className="term-side">
            <div className="term-card">
              <h4>Состояние узла</h4>
              <div className="term-kv">
                <span>API-канал</span>
                <b className={apiOk === false ? "term-w" : "term-g"}>{apiOk === false ? "нет ответа" : "устойчив"}</b>
              </div>
              <div className="term-kv">
                <span>Аутентификация</span>
                <b className="term-dim">ожидание</b>
              </div>
              <div className="term-kv">
                <span>Сессия</span>
                <b className="term-dim">не открыта</b>
              </div>
            </div>
          </div>
        </div>

        <div className="term-deck">
          <div className="term-keys">
            <button type="button" className="term-key term-key-primary" onClick={login}>
              Войти через Discord
            </button>
            <a className="term-key" href={DISCORD_INVITE_URL} target="_blank" rel="noreferrer">
              Приглашение в Discord
            </a>
          </div>
          <span className="term-hint">ENTER — войти через Discord</span>
        </div>
      </div>
    </div>
  );
}
