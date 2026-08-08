import { useEffect, useRef, useState } from "react";

// Ручной ввод (человека ещё нет в составе, например только вступивший рекрут)
// хранится среди selectedIds с этим префиксом — см. ReportCategoryField.allow_manual
export const MANUAL_ENTRY_PREFIX = "manual:";

export function isManualEntry(id) {
  return typeof id === "string" && id.startsWith(MANUAL_ENTRY_PREFIX);
}

export function manualEntryName(id) {
  return id.slice(MANUAL_ENTRY_PREFIX.length);
}

/** Выплывающий список состава формирования с мульти-выбором — для полей категории
 * типа "roster" (например, отметить, кто именно был в патруле). allowManual
 * (см. ReportCategoryField.allow_manual) добавляет ручной ввод текстом для тех,
 * кого ещё нет в составе. */
export function RosterFieldPicker({ members, selectedIds, onChange, allowManual = false }) {
  const [open, setOpen] = useState(false);
  const [manualInput, setManualInput] = useState("");
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

  function addManual() {
    const name = manualInput.trim();
    if (!name) return;
    const id = MANUAL_ENTRY_PREFIX + name;
    if (!selectedIds.includes(id)) onChange([...selectedIds, id]);
    setManualInput("");
  }

  function removeManual(id) {
    onChange(selectedIds.filter((x) => x !== id));
  }

  function label(m) {
    return m._regimentName ? `${m.username} (${m._regimentName})` : m.username;
  }

  const manualIds = selectedIds.filter(isManualEntry);
  const selectedNames = [
    ...members.filter((m) => selectedIds.includes(m.discord_id)).map(label),
    ...manualIds.map((id) => `${manualEntryName(id)} (не в составе)`),
  ];

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
                {label(m)}
              </label>
            ))
          )}
          {allowManual && (
            <div className="roster-picker-manual">
              {manualIds.length > 0 && (
                <ul className="field-tags">
                  {manualIds.map((id) => (
                    <li key={id} className="field-tag">
                      {manualEntryName(id)} (не в составе)
                      <button type="button" onClick={() => removeManual(id)}>
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="roster-picker-manual-input">
                <input
                  type="text"
                  placeholder="Вписать вручную (человека нет в составе)"
                  value={manualInput}
                  onChange={(e) => setManualInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addManual();
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
                <button type="button" onClick={addManual}>
                  + Добавить
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
