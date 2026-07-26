import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

const POLL_INTERVAL_MS = 60000;

/** Всегда видимый баннер сверху, пока есть хоть одна заявка на повышение,
 * ожидающая решения (список от бэкенда уже отфильтрован — виден только тем, кто
 * реально может её одобрить: заместитель/командир формирования, высшее
 * командование, администратор). */
export function PromotionBanner() {
  const { token, access } = useAuth();
  const [count, setCount] = useState(0);

  const canSeeAny = access?.is_admin || access?.is_high_command || (access?.commander_regiment_ids || []).length > 0;

  useEffect(() => {
    if (!canSeeAny) return undefined;
    function load() {
      api
        .listPromotionRequests(token)
        .then((data) => setCount(data.length))
        .catch(() => setCount(0));
    }
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [token, canSeeAny]);

  if (!canSeeAny || count === 0) return null;

  return (
    <Link to="/promotions" className="promotion-banner">
      {count === 1 ? "1 заявка на повышение ожидает решения" : `${count} заявок на повышение ожидают решения`} →
    </Link>
  );
}
