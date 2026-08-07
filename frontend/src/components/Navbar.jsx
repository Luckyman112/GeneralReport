import { useAuth } from "../auth/AuthContext";
import { useTheme } from "../hooks/useTheme";
import { BroadcastModal } from "./BroadcastModal";
import { CharacterSwitcher } from "./CharacterSwitcher";
import { GlobalSearch } from "./GlobalSearch";
import { CrossIcon, MegaphoneIcon, MenuIcon, MoonIcon, SunIcon } from "./icons";
import { NotificationBell } from "./NotificationBell";
import { PasswordEscalation } from "./PasswordEscalation";
import { useState } from "react";

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

/** Верхняя панель — поиск/уведомления/аккаунт. Навигация по разделам живёт
 * в Sidebar.jsx (см. App.jsx: постоянный сайдбар на десктопе вместо этой
 * панели, чтобы не раздувать горизонтальный ряд с каждым новым разделом). */
export function Navbar({ onBurgerClick, sidebarOpen }) {
  const { user, access, regiments, logout, activeCharacter } = useAuth();
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [theme, toggleTheme] = useTheme();
  const positionLabel = activeCharacter
    ? `${activeCharacter.regiment.name} (второй персонаж)`
    : buildPositionLabel(access, regiments);
  const nameColor = activeCharacter ? activeCharacter.regiment.color : ownRegimentColor(access, regiments);
  const displayName = activeCharacter?.callsign || user?.username;

  return (
    <nav className="navbar">
      <div className="navbar-left">
        <button
          type="button"
          className="ghost navbar-burger"
          aria-label={sidebarOpen ? "Закрыть меню" : "Открыть меню"}
          aria-expanded={sidebarOpen}
          onClick={onBurgerClick}
        >
          {sidebarOpen ? <CrossIcon /> : <MenuIcon />}
        </button>

        <GlobalSearch />
      </div>

      <div className="navbar-user">
        <button
          className="ghost navbar-theme-toggle"
          title={theme === "dark" ? "Светлая тема" : "Тёмная тема"}
          onClick={toggleTheme}
        >
          {theme === "dark" ? <SunIcon /> : <MoonIcon />}
        </button>
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
    </nav>
  );
}
