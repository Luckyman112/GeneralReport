import { useCallback, useEffect, useState } from "react";
import { api } from "../api/client";
import { useLiveEvents } from "../hooks/useLiveEvents";

const POLL_INTERVAL_MS = 60000;

/** Режим обслуживания — публичный статус, виден даже без входа. Обычным
 * пользователям показывает полноэкранную заглушку, администратору — не блокирует
 * доступ, а лишь показывает баннер-напоминание (чтобы он мог сам зайти и выключить
 * режим после миграции/восстановления из бэкапа). */
export function useMaintenanceStatus() {
  const [status, setStatus] = useState(null);

  const load = useCallback(() => {
    api.getMaintenanceStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load]);

  useLiveEvents("maintenance", load);

  return status;
}

export function MaintenanceBanner({ status }) {
  if (!status?.enabled) return null;
  return (
    <div className="maintenance-banner">
      Идёт техническое обслуживание{status.message ? `: ${status.message}` : "."} Не забудьте выключить режим
      обслуживания после завершения работ.
    </div>
  );
}

export function MaintenanceBlock({ status }) {
  return (
    <div className="maintenance-block">
      <h2>Технические работы</h2>
      <p>{status?.message || "Сайт временно недоступен, идут технические работы. Загляните чуть позже."}</p>
    </div>
  );
}
