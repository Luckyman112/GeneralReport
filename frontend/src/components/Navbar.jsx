import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { NotificationBell } from "./NotificationBell";

function buildPositionLabel(access, regiments) {
  if (!access) return "";

  const parts = [];
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
  const { user, access, regiments, logout } = useAuth();
  const positionLabel = buildPositionLabel(access, regiments);
  const nameColor = ownRegimentColor(access, regiments);

  return (
    <nav className="navbar">
      <div className="navbar-brand">COLLAPSAR</div>
      <div className="navbar-links">
        <Link to="/reports">Рапорты</Link>
        {access?.can_view_violations && <Link to="/violations">Нарушители</Link>}
        {access?.is_admin && <Link to="/regiments">Формирования</Link>}
        {access?.is_password_login && <Link to="/settings">Настройки</Link>}
      </div>
      <div className="navbar-user">
        <NotificationBell />
        {user?.avatar_url && <img src={user.avatar_url} alt="" className="navbar-avatar" />}
        <span className="navbar-user-info">
          <span className="navbar-username" style={nameColor ? { color: nameColor } : undefined}>
            {user?.username}
          </span>
          {positionLabel && <span className="navbar-position">{positionLabel}</span>}
        </span>
        <button className="ghost" onClick={logout}>
          Выйти
        </button>
      </div>
    </nav>
  );
}
