import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { formatFullName } from "../utils/formatName";
import { InlineSpinner } from "./InlineSpinner";

const ROLE_LABELS = {
  commander: "Командир",
  deputy: "Заместитель",
  mentor: "Наставник",
};

/** Статичный список командования всех формирований — показывается справа на
 * странице Штаба вместо обычного состава (см. решение пользователя): высшее
 * командование сверху отдельным блоком, ниже формирования со своими
 * командиром/замами. Не кликабельный, просто справочный список. */
export function HqLeadershipPanel() {
  const { token } = useAuth();
  const [data, setData] = useState(null);

  useEffect(() => {
    api
      .getHqLeadership(token)
      .then(setData)
      .catch(() => setData({ high_command: [], formations: [] }));
  }, [token]);

  if (!data) return <InlineSpinner />;

  return (
    <div className="hq-leadership-panel">
      <h3>Высшее командование</h3>
      {data.high_command.length === 0 ? (
        <p className="hint-text">Не назначено.</p>
      ) : (
        <ul className="hq-leadership-list">
          {data.high_command.map((p) => (
            <li key={p.discord_id}>{formatFullName(p)}</li>
          ))}
        </ul>
      )}

      {data.formations.map((f) => (
        <div key={f.regiment_id} className="hq-formation-block">
          <h4 style={f.regiment_color ? { color: f.regiment_color } : undefined}>{f.regiment_name}</h4>
          {f.commanders.length === 0 ? (
            <p className="hint-text">Не назначено.</p>
          ) : (
            <ul className="hq-leadership-list">
              {f.commanders.map((c) => (
                <li key={c.person.discord_id}>
                  {formatFullName(c.person)}{" "}
                  <span className="hint-text">({ROLE_LABELS[c.role_type] || c.role_type})</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
