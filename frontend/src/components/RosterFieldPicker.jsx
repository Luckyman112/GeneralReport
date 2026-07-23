import { useEffect, useRef, useState } from "react";

/** Выплывающий список состава формирования с мульти-выбором — для полей категории
 * типа "roster" (например, отметить, кто именно был в патруле). */
export function RosterFieldPicker({ members, selectedIds, onChange }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function handleOutsideClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [open]);

  function toggle(discordId) {
    if (selectedIds.includes(discordId)) {
      onChange(selectedIds.filter((id) => id !== discordId));
    } else {
      onChange([...selectedIds, discordId]);
    }
  }

  const selectedNames = members.filter((m) => selectedIds.includes(m.discord_id)).map((m) => m.username);

  return (
    <div className="roster-picker" ref={wrapRef}>
      <button type="button" className="roster-picker-toggle" onClick={() => setOpen((v) => !v)}>
        {selectedNames.length > 0 ? selectedNames.join(", ") : "— выбрать состав —"}
      </button>
      {open && (
        <div className="roster-picker-flyout">
          {members.length === 0 ? (
            <p className="hint-text">Состав формирования пуст.</p>
          ) : (
            members.map((m) => (
              <label key={m.discord_id} className="roster-picker-option">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(m.discord_id)}
                  onChange={() => toggle(m.discord_id)}
                />
                {m.username}
              </label>
            ))
          )}
        </div>
      )}
    </div>
  );
}
