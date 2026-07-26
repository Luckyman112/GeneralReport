import { useEffect } from "react";
import { useAuth } from "../auth/AuthContext";

// Один общий SSE-канал на всё приложение (а не по соединению на каждый компонент,
// который подписался) — держим в модульном состоянии, как view-as в client.js.
let eventSource = null;
let currentToken = null;
const listeners = new Set();

function ensureConnection(token) {
  if (currentToken === token && eventSource) return;
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  currentToken = token;
  if (!token) return;

  const source = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
  source.onmessage = (e) => {
    for (const listener of listeners) listener(e.data);
  };
  // EventSource сам переподключается при обрыве — ничего дополнительно делать не нужно
  eventSource = source;
}

/** Подписка на живые обновления с сервера (SSE) — вместо/в дополнение к
 * периодическому опросу API. eventTypes — строка или массив ("reports",
 * "promotions", "registrations", "leave_requests", "notifications"). */
export function useLiveEvents(eventTypes, callback) {
  const { token } = useAuth();

  useEffect(() => {
    ensureConnection(token);
  }, [token]);

  useEffect(() => {
    const types = Array.isArray(eventTypes) ? eventTypes : [eventTypes];
    function listener(eventType) {
      if (types.includes(eventType)) callback();
    }
    listeners.add(listener);
    return () => listeners.delete(listener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callback, Array.isArray(eventTypes) ? eventTypes.join(",") : eventTypes]);
}
