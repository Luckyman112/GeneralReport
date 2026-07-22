import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export function Navbar() {
  const { user, access, logout } = useAuth();

  return (
    <nav className="navbar">
      <div className="navbar-brand">COLLAPSAR</div>
      <div className="navbar-links">
        <Link to="/reports">Рапорты</Link>
        {access?.is_admin && <Link to="/regiments">Формирования</Link>}
      </div>
      <div className="navbar-user">
        {user?.avatar_url && <img src={user.avatar_url} alt="" className="navbar-avatar" />}
        <span>{user?.username}</span>
        <button className="ghost" onClick={logout}>
          Выйти
        </button>
      </div>
    </nav>
  );
}
