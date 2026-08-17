import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { RosterBrowserModal } from "./RosterBrowserModal";

/** Левый сайдбар — постоянно видим на десктопе (структура из best-practice CRM
 * референса: сайдбар вместо горизонтального навбара, который раздувался с
 * каждым новым разделом), на узких экранах превращается в выезжающую панель,
 * открываемую бургером из Navbar (см. App.jsx — состояние open общее). */
export function Sidebar({ open, onClose }) {
  const { user, access, regiments } = useAuth();
  const [showRoster, setShowRoster] = useState(false);

  const needsRegistration =
    user?.registration_status !== "approved" && !access?.is_admin && !access?.is_high_command;
  const hasCommandAccess =
    access?.is_admin || access?.is_high_command || (access?.commander_regiment_ids || []).length > 0;
  const hqRegiment = regiments.find((r) => r.name === "Штаб");
  const isHqMember = Boolean(hqRegiment && (access?.soldier_regiment_ids || []).includes(hqRegiment.id));
  const isDisciplineDeputy = (access?.deputy_disciplines || []).length > 0;
  // Обучен на ветку (держит специализацию) либо инструктор/DEP/CU этой ветки —
  // тот же критерий, что и доступ к самой странице (см. решение пользователя:
  // разделы Медицина/Инженерия не для всех подряд)
  function hasDisciplineAccess(discipline) {
    return (
      access?.is_admin ||
      (access?.specialization_disciplines || []).includes(discipline) ||
      (access?.instructor_disciplines || []).includes(discipline) ||
      (access?.deputy_disciplines || []).includes(discipline)
    );
  }

  return (
    <>
      {open && <div className="sidebar-backdrop" onClick={onClose} />}
      <aside className={`sidebar${open ? " sidebar-open" : ""}`}>
        <div className="sidebar-brand">COLLAPSAR</div>

        {!needsRegistration && (
          <nav className="sidebar-links">
            <div className="sidebar-links-group">
              <span className="sidebar-links-group-label">Служба</span>
              <Link to="/main" onClick={onClose}>Главное</Link>
              <Link to="/reports" onClick={onClose}>Рапорты</Link>
              <Link to="/violations" onClick={onClose}>Нарушители</Link>
              <button
                type="button"
                className="ghost sidebar-link-button"
                onClick={() => {
                  setShowRoster(true);
                  onClose();
                }}
              >
                Состав
              </button>
              <Link to="/promotions" onClick={onClose}>Повышения</Link>
              <Link to="/recruits" onClick={onClose}>Рекрутская</Link>
              {/* Отдельная статическая страница (frontend/public/galaxy-map.html), не
                  часть SPA-роутинга — читает JWT из того же localStorage напрямую и
                  ходит в /api/galaxy-map сама, поэтому открывается обычной ссылкой,
                  а не через <Link>/HashRouter */}
              <a href="/galaxy-map.html" target="_blank" rel="noreferrer" onClick={onClose}>
                Галактика
              </a>
            </div>

            {(hasCommandAccess || isHqMember || isDisciplineDeputy) && (
              <div className="sidebar-links-group">
                <span className="sidebar-links-group-label">Командование</span>
                {hqRegiment && (hasCommandAccess || isHqMember) && (
                  <Link to={`/reports?regiment=${hqRegiment.id}`} onClick={onClose}>Штаб</Link>
                )}
                {hasCommandAccess && <Link to="/registrations" onClick={onClose}>Регистрации</Link>}
                {hasCommandAccess && <Link to="/transfers" onClick={onClose}>Переводы</Link>}
                {isDisciplineDeputy && <Link to="/discipline" onClick={onClose}>Дисциплина</Link>}
                {isDisciplineDeputy && !access?.is_admin && <Link to="/logs" onClick={onClose}>Журнал</Link>}
              </div>
            )}

            <div className="sidebar-links-group">
              <span className="sidebar-links-group-label">Специализации</span>
              <Link to="/instructor-room" onClick={onClose}>Инструкторская</Link>
              {hasDisciplineAccess("medic") && (
                <Link to="/specializations/medic" onClick={onClose}>Медицина</Link>
              )}
              {hasDisciplineAccess("engineer") && (
                <Link to="/specializations/engineer" onClick={onClose}>Инженерия</Link>
              )}
            </div>

            {(access?.is_admin || access?.can_access_event_room || access?.is_admin_staff) && (
              <div className="sidebar-links-group">
                <span className="sidebar-links-group-label">Администрирование</span>
                {access?.can_access_event_room && <Link to="/event-room" onClick={onClose}>Ивентрум</Link>}
                {(access?.is_admin_staff || access?.is_admin) && (
                  <Link to="/admin-staff" onClick={onClose}>Администрация</Link>
                )}
                {access?.is_admin && <Link to="/regiments" onClick={onClose}>Формирования</Link>}
                {access?.is_admin && <Link to="/admin-panel" onClick={onClose}>Админ-панель</Link>}
                {access?.is_admin && <Link to="/backups" onClick={onClose}>Резервные копии</Link>}
                {access?.is_admin && <Link to="/logs" onClick={onClose}>Журнал</Link>}
                {access?.is_admin && <Link to="/settings" onClick={onClose}>Настройки</Link>}
              </div>
            )}
          </nav>
        )}
      </aside>

      {showRoster && <RosterBrowserModal onClose={() => setShowRoster(false)} />}
    </>
  );
}
