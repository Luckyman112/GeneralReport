import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { useTheme } from "../hooks/useTheme";
import { BroadcastModal } from "./BroadcastModal";
import { CharacterSwitcher } from "./CharacterSwitcher";
import { GlobalSearch } from "./GlobalSearch";
import { MegaphoneIcon, MoonIcon, SunIcon } from "./icons";
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
  const [theme, toggleTheme] = useTheme();
  const positionLabel = activeCharacter
    ? `${activeCharacter.regiment.name} (второй персонаж)`
    : buildPositionLabel(access, regiments);
  const nameColor = activeCharacter ? activeCharacter.regiment.color : ownRegimentColor(access, regiments);
  const displayName = activeCharacter?.callsign || user?.username;

  return (
    <nav className="navbar">
      <div className="navbar-brand">COLLAPSAR</div>
      <div className="navbar-links">
        <Link to="/main">Главное</Link>
        <Link to="/reports">Рапорты</Link>
        {access?.can_view_violations && <Link to="/violations">Нарушители</Link>}
        <Link to="/instructor-room">Инструкторская</Link>
        <Link to="/promotions">Повышения</Link>
        <button className="ghost navbar-link-button" onClick={() => setShowRoster(true)}>
          Состав
        </button>
        {(access?.is_admin || access?.is_high_command || (access?.commander_regiment_ids || []).length > 0) && (
          <Link to="/registrations">Регистрации</Link>
        )}
        {(access?.is_admin || access?.is_high_command || (access?.commander_regiment_ids || []).length > 0) && (
          <Link to="/transfers">Переводы</Link>
        )}
        {access?.is_admin && <Link to="/regiments">Формирования</Link>}
        {access?.is_admin && <Link to="/admin-panel">Админ-панель</Link>}
        {access?.is_admin && <Link to="/backups">Резервные копии</Link>}
        {access?.is_admin && <Link to="/settings">Настройки</Link>}
      </div>
      <div className="navbar-user">
        <button
          className="ghost"
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
        <button className="ghost" onClick={logout}>
          Выйти
        </button>
      </div>

      {showBroadcast && <BroadcastModal onClose={() => setShowBroadcast(false)} />}
      {showRoster && <RosterBrowserModal onClose={() => setShowRoster(false)} />}
    </nav>
  );
}
