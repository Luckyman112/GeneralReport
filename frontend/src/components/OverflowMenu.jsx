import { useEffect, useRef, useState } from "react";

/** Компактное меню "⋯" для второстепенных действий тулбара — чтобы не держать
 * их всегда на виду наравне с основным (primary) действием страницы. */
export function OverflowMenu({ items }) {
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

  const visibleItems = items.filter(Boolean);
  if (visibleItems.length === 0) return null;

  return (
    <div className="overflow-menu" ref={wrapRef}>
      <button
        type="button"
        className="ghost overflow-menu-trigger"
        aria-label="Ещё действия"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        ⋯
      </button>
      {open && (
        <div className="overflow-menu-flyout">
          {visibleItems.map((item) => (
            <button
              key={item.label}
              type="button"
              className={item.danger ? "overflow-menu-item overflow-menu-item-danger" : "overflow-menu-item"}
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
