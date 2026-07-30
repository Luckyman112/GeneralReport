import { useEffect, useRef, useState } from "react";

/** Выплывающий список с мульти-выбором для произвольного набора элементов
 * ({id, name}) — например, Discord-ролей в настройках доступа. Тот же паттерн,
 * что и RosterFieldPicker, но не завязан на формат участника сервера. */
export function MultiSelectDropdown({ items, selectedIds, onChange, placeholder = "— ничего не выбрано —" }) {
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

  function toggle(id) {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id));
    } else {
      onChange([...selectedIds, id]);
    }
  }

  const selectedNames = items.filter((item) => selectedIds.includes(item.id)).map((item) => item.name);

  return (
    <div className="roster-picker" ref={wrapRef}>
      <button type="button" className="roster-picker-toggle" onClick={() => setOpen((v) => !v)}>
        {selectedNames.length > 0 ? selectedNames.join(", ") : placeholder}
      </button>
      {open && (
        <div className="roster-picker-flyout">
          {items.length === 0 ? (
            <p className="hint-text">Список пуст.</p>
          ) : (
            items.map((item) => (
              <label key={item.id} className="roster-picker-option">
                <input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => toggle(item.id)} />
                {item.name}
              </label>
            ))
          )}
        </div>
      )}
    </div>
  );
}
