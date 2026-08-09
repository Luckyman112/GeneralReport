import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";

/** Полноэкранная заглушка для неактивного бойца — не пускает к рапортам и
 * подсказывает, к каким командирам его формирования обратиться в Discord. */
export function InactiveBlock() {
  const { token, access, regiments } = useAuth();
  const [commanderNames, setCommanderNames] = useState([]);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    const regimentIds = [...new Set([...(access?.soldier_regiment_ids || []), ...(access?.commander_regiment_ids || [])])];
    if (regimentIds.length === 0) return;

    Promise.all(regimentIds.map((id) => api.listCommanders(token, id).catch(() => [])))
      .then((lists) => {
        if (requestIdRef.current !== requestId) return;
        const names = lists
          .flat()
          .filter((c) => c.role_type === "commander")
          .map((c) => c.username);
        setCommanderNames([...new Set(names)]);
      })
      .catch(() => {
        if (requestIdRef.current === requestId) setCommanderNames([]);
      });
  }, [token, access, regiments]);

  return (
    <div className="inactive-block">
      <h2>Вы отмечены как неактивный боец</h2>
      <p>Вы не можете создавать и просматривать рапорты, пока отметка не будет снята.</p>
      <p>
        Обратитесь в Discord к командиру вашего формирования
        {commanderNames.length > 0 ? `: ${commanderNames.join(", ")}` : "."}
      </p>
    </div>
  );
}
