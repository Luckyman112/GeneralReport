import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useLiveEvents } from "../hooks/useLiveEvents";
import { BellIcon } from "./icons";
import { formatMskDate } from "../utils/formatDate";

// SSE обновляет мгновенно — поллинг оставлен редким запасным вариантом
const POLL_INTERVAL_MS = 120000;

export function NotificationBell() {
  const { token } = useAuth();
  const [notifications, setNotifications] = useState([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  const load = useCallback(async () => {
    try {
      setNotifications(await api.listNotifications(token));
    } catch {
      // тихо игнорируем — колокольчик не критичен для основного функционала
    }
  }, [token]);

  useLiveEvents("notifications", load);

  useEffect(() => {
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    if (!open) return undefined;
    function handleOutsideClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [open]);

  async function handleToggle() {
    const willOpen = !open;
    setOpen(willOpen);
    if (willOpen && unreadCount > 0) {
      try {
        await api.markAllNotificationsRead(token);
        setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      } catch {
        // не критично — просто останется непрочитанным до следующего открытия
      }
    }
  }

  return (
    <div className="notification-bell-wrap" ref={wrapRef}>
      <button type="button" className="ghost notification-bell-button" onClick={handleToggle} title="Уведомления">
        <BellIcon />
        {unreadCount > 0 && <span className="notification-bell-badge">{unreadCount}</span>}
      </button>

      {open && (
        <div className="notification-flyout">
          {notifications.length === 0 ? (
            <p className="hint-text">Уведомлений нет.</p>
          ) : (
            notifications.map((n) => (
              <div key={n.id} className="notification-item">
                <strong>{n.title}</strong>
                <p>{n.body}</p>
                <span className="notification-item-date">{formatMskDate(n.created_at)} МСК</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
