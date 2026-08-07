import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useLiveEvents } from "../hooks/useLiveEvents";

// SSE обновляет мгновенно — поллинг оставлен редким запасным вариантом
const POLL_INTERVAL_MS = 120000;

/** Всегда видимый баннер сверху, пока есть хоть одна заявка на повышение,
 * ожидающая решения — только для тех, кому это должно "само бросаться в глаза":
 * создатель и командиры/замы формирований. Высшее командование тоже может
 * одобрять (см. can_decide_promotion на бэкенде), но баннер ему специально не
 * показываем — сами зайдут в "Повышения", если нужно. Обычный администратор
 * (не создатель) больше не может одобрять вовсе, поэтому и баннер ему не нужен. */
export function PromotionBanner() {
  const { token, access } = useAuth();
  const [count, setCount] = useState(0);

  const canSeeAny = access?.is_founder || (access?.commander_regiment_ids || []).length > 0;

  const load = useCallback(() => {
    if (!canSeeAny) return;
    api
      .listPromotionRequests(token)
      .then((data) => setCount(data.length))
      .catch(() => setCount(0));
  }, [token, canSeeAny]);

  useLiveEvents("promotions", load);

  useEffect(() => {
    if (!canSeeAny) return undefined;
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [canSeeAny, load]);

  if (!canSeeAny || count === 0) return null;

  return (
    <Link to="/promotions" className="promotion-banner">
      {count === 1 ? "1 заявка на повышение ожидает решения" : `${count} заявок на повышение ожидают решения`} →
    </Link>
  );
}
