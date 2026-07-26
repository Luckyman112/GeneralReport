import { useState } from "react";
import { useAuth } from "../auth/AuthContext";

const ROLE_LABELS = {
  soldier: "Боец",
  deputy: "Заместитель",
  commander: "Командир",
  high_command: "Высшее командование",
};

/** Полоска "просмотр от лица" — реальный админ/высшее командование может временно
 * урезать себе доступ до конкретной роли/формирования и честно увидеть, что видит
 * и может человек с такими правами (не косметика — бэкенд реально это применяет).
 * Показывается всегда, независимо от текущей страницы, чтобы можно было выйти из
 * симуляции, даже если она заблокировала доступ к текущему разделу. */
export function ViewAsBar() {
  const { access, regiments, viewAs, applyViewAs, resetViewAs } = useAuth();
  const [role, setRole] = useState("commander");
  const [regimentId, setRegimentId] = useState(regiments[0]?.id ?? "");
  const [open, setOpen] = useState(false);

  if (!access?.is_real_admin) return null;

  const needsRegiment = role !== "high_command";

  async function handleApply() {
    await applyViewAs(role, needsRegiment ? Number(regimentId) : null);
    setOpen(false);
  }

  if (viewAs.role) {
    const regimentName = regiments.find((r) => r.id === viewAs.regimentId)?.name;
    return (
      <div className="view-as-bar">
        Смотрите как: <strong>{ROLE_LABELS[viewAs.role] || viewAs.role}</strong>
        {regimentName && ` — ${regimentName}`}
        <button className="ghost" onClick={resetViewAs}>
          Выключить просмотр
        </button>
      </div>
    );
  }

  return (
    <div className="view-as-bar view-as-bar-idle">
      {open ? (
        <>
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="soldier">Боец</option>
            <option value="deputy">Заместитель</option>
            <option value="commander">Командир</option>
            <option value="high_command">Высшее командование</option>
          </select>
          {needsRegiment && (
            <select value={regimentId} onChange={(e) => setRegimentId(e.target.value)}>
              {regiments.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          )}
          <button className="primary" onClick={handleApply} disabled={needsRegiment && !regimentId}>
            Применить
          </button>
          <button className="ghost" onClick={() => setOpen(false)}>
            Отмена
          </button>
        </>
      ) : (
        <button className="ghost" onClick={() => setOpen(true)}>
          Просмотр от лица...
        </button>
      )}
    </div>
  );
}
