import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { LinkIcon } from "./icons";

/** Инфо-панель формирования: кто командир/заместитель, ссылка на Discord-канал и
 * состав по званиям — быстрая справка без похода в настройки. */
export function RegimentInfoModal({ regiment, onClose }) {
  const { token } = useAuth();
  const [commanders, setCommanders] = useState([]);
  const [tiers, setTiers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([api.listCommanders(token, regiment.id), api.getRanks(token)])
      .then(([commandersData, tiersData]) => {
        setCommanders(commandersData);
        setTiers(tiersData);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token, regiment.id]);

  const commanderNames = commanders.filter((c) => c.role_type === "commander").map((c) => c.username);
  const deputyNames = commanders.filter((c) => c.role_type === "deputy").map((c) => c.username);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 style={regiment.color ? { color: regiment.color } : undefined}>{regiment.name}</h3>

        {loading ? (
          <p className="hint-text">Загрузка...</p>
        ) : error ? (
          <p className="error-text">{error}</p>
        ) : (
          <>
            <p>
              <strong>Командир:</strong> {commanderNames.length > 0 ? commanderNames.join(", ") : "не назначен"}
            </p>
            <p>
              <strong>Заместитель:</strong> {deputyNames.length > 0 ? deputyNames.join(", ") : "не назначен"}
            </p>

            {regiment.discord_channel_url && (
              <p>
                <a
                  href={regiment.discord_channel_url}
                  target="_blank"
                  rel="noreferrer"
                  className="regiment-info-channel-link"
                >
                  <LinkIcon /> Перейти в канал формирования
                </a>
              </p>
            )}

            <h4>Звания формирования</h4>
            <ul className="category-list">
              {tiers.flatMap((tier) =>
                tier.ranks.map((r) => (
                  <li key={r.id}>
                    {r.code} — {r.name}
                  </li>
                ))
              )}
            </ul>
          </>
        )}

        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
