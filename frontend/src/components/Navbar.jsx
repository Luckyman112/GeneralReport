import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useTheme } from "../hooks/useTheme";
import { BroadcastModal } from "./BroadcastModal";
import { CharacterSwitcher } from "./CharacterSwitcher";
import { GlobalSearch } from "./GlobalSearch";
import { CrossIcon, MegaphoneIcon, MenuIcon, MoonIcon, SunIcon } from "./icons";
import { NotificationBell } from "./NotificationBell";
import { PasswordEscalation } from "./PasswordEscalation";
import { RosterBrowserModal } from "./RosterBrowserModal";

function buildPositionLabel(access, regiments) {
  if (!access) return "";

  const parts = [];
  if (access.is_high_command) parts.push("Высшее командование");
  if (access.is_admin && !access.is_password_login) parts.push("Администратор");

  for (const regiment of regiments) {
    let role = null;
    if (access.category_manager_regiment_ids?.includes(regiment.id)) role = "Командир";
    else if (access.commander_regiment_ids?.includes(regiment.id)) role = "Заместитель";
    else if (access.soldier_regiment_ids?.includes(regiment.id)) role = "Боец";

    if (role) parts.push(`${regiment.name} (${role})`);
  }

  return parts.join(", ");
}

function ownRegimentColor(access, regiments) {
  if (!access) return null;
  const ownIds = new Set([...(access.commander_regiment_ids || []), ...(access.soldier_regiment_ids || [])]);
  const own = regiments.find((r) => ownIds.has(r.id) && r.color);
  return own?.color || null;
}

export function Navbar() {
  const { user, access, regiments, logout, activeCharacter } = useAuth();
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [showRoster, setShowRoster] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, toggleTheme] = useTheme();
  const location = useLocation();
  const positionLabel = activeCharacter
    ? `${activeCharacter.regiment.name} (второй персонаж)`
    : buildPositionLabel(access, regiments);
  const nameColor = activeCharacter ? activeCharacter.regiment.color : ownRegimentColor(access, regiments);
  const displayName = activeCharacter?.callsign || user?.username;
  const needsRegistration =
    user?.registration_status !== "approved" && !access?.is_admin && !access?.is_high_command;
  const hasCommandAccess =
    access?.is_admin || access?.is_high_command || (access?.commander_regiment_ids || []).length > 0;
  const hqRegiment = regiments.find((r) => r.name === "Штаб");
  const isHqMember = Boolean(hqRegiment && (access?.soldier_regiment_ids || []).includes(hqRegiment.id));

  // Закрываем мобильное меню при переходе на другой роут и блокируем скролл
  // страницы под ним, пока оно открыто — иначе фон "плавает" за выезжающей панелью.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    document.body.style.overflow = "hidden";
    const onKeyDown = (e) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);

  return (
    <nav className="navbar">
      <div className="navbar-brand">COLLAPSAR</div>

      <button
        type="button"
        className="ghost navbar-burger"
        aria-label={menuOpen ? "Закрыть меню" : "Открыть меню"}
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((v) => !v)}
      >
        {menuOpen ? <CrossIcon /> : <MenuIcon />}
      </button>

      {menuOpen && <div className="navbar-links-backdrop" onClick={closeMenu} />}

      <div className={`navbar-links${menuOpen ? " navbar-links-open" : ""}`}>
        {!needsRegistration && (
          <>
            <div className="navbar-links-group">
              <span className="navbar-links-group-label">Служба</span>
              <Link to="/main" onClick={closeMenu}>Главное</Link>
              <Link to="/reports" onClick={closeMenu}>Рапорты</Link>
              <button
                type="button"
                className="ghost navbar-link-button"
                onClick={() => {
                  setShowRoster(true);
                  closeMenu();
                }}
              >
                Состав
              </button>
              <Link to="/instructor-room" onClick={closeMenu}>Инструкторская</Link>
              <Link to="/promotions" onClick={closeMenu}>Повышения</Link>
            </div>

            {(access?.can_view_violations || hasCommandAccess || isHqMember) && (
              <div className="navbar-links-group">
                <span className="navbar-links-group-label">Командование</span>
                {access?.can_view_violations && (
                  <Link to="/violations" onClick={closeMenu}>Нарушители</Link>
                )}
                {hqRegiment && (hasCommandAccess || isHqMember) && (
                  <Link to={`/reports?regiment=${hqRegiment.id}`} onClick={closeMenu}>Штаб</Link>
                )}
                {hasCommandAccess && <Link to="/registrations" onClick={closeMenu}>Регистрации</Link>}
                {hasCommandAccess && <Link to="/transfers" onClick={closeMenu}>Переводы</Link>}
              </div>
            )}

            {access?.is_admin && (
              <div className="navbar-links-group">
                <span className="navbar-links-group-label">Администрирование</span>
                <Link to="/regiments" onClick={closeMenu}>Формирования</Link>
                <Link to="/admin-panel" onClick={closeMenu}>Админ-панель</Link>
                <Link to="/backups" onClick={closeMenu}>Резервные копии</Link>
                <Link to="/logs" onClick={closeMenu}>Журнал</Link>
                <Link to="/settings" onClick={closeMenu}>Настройки</Link>
              </div>
            )}
          </>
        )}

        {/* На мобильном меню — та же панель, что и ссылки, так что действия
           пользователя (тема/поиск/выход) дублируются сюда, а в верхней строке
           на мобильном скрыты (см. styles.css), чтобы не толкаться с бургером. */}
        <div className="navbar-links-group navbar-links-group-user">
          <span className="navbar-links-group-label">Аккаунт</span>
          <button type="button" className="ghost navbar-link-button" onClick={toggleTheme}>
            {theme === "dark" ? "Светлая тема" : "Тёмная тема"}
          </button>
          <button
            type="button"
            className="ghost navbar-link-button"
            onClick={() => {
              logout();
              closeMenu();
            }}
          >
            Выйти
          </button>
        </div>
      </div>

      <div className="navbar-user">
        <button
          className="ghost navbar-theme-toggle"
          title={theme === "dark" ? "Светлая тема" : "Тёмная тема"}
          onClick={toggleTheme}
        >
          {theme === "dark" ? <SunIcon /> : <MoonIcon />}
        </button>
        <GlobalSearch />
        {access?.can_send_broadcast && (
          <button className="ghost" title="Объявление всем" onClick={() => setShowBroadcast(true)}>
            <MegaphoneIcon />
          </button>
        )}
        <NotificationBell />
        <CharacterSwitcher />
        {!access?.is_password_login && access?.can_escalate_password_login && <PasswordEscalation />}
        {user?.avatar_url && <img src={user.avatar_url} alt="" className="navbar-avatar" />}
        <span className="navbar-user-info">
          <span className="navbar-username" style={nameColor ? { color: nameColor } : undefined}>
            {displayName}
          </span>
          {positionLabel && <span className="navbar-position">{positionLabel}</span>}
        </span>
        <button className="ghost navbar-logout" onClick={logout}>
          Выйти
        </button>
      </div>

      {showBroadcast && <BroadcastModal onClose={() => setShowBroadcast(false)} />}
      {showRoster && <RosterBrowserModal onClose={() => setShowRoster(false)} />}
    </nav>
  );
}
