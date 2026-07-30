import { useEffect, useMemo, useRef, useState } from "react";
import { formatFullName } from "../utils/formatName";

// searches by discord username or web nick (service id/rank/callsign)
export function MemberSearchPicker({ members, selectedId, onSelect }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  const selected = members.find((m) => m.discord_id === selectedId);

  useEffect(() => {
    if (!open) return undefined;
    function handleOutsideClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? members.filter((m) => {
          if (m.username.toLowerCase().includes(q)) return true;
          if (m.callsign && m.callsign.toLowerCase().includes(q)) return true;
          if (m.service_id && m.service_id.includes(q)) return true;
          return false;
        })
      : members;
    return list.slice(0, 50);
  }, [members, query]);

  return (
    <div className="roster-picker" ref={wrapRef}>
      <button type="button" className="roster-picker-toggle" onClick={() => setOpen((v) => !v)}>
        {selected ? formatFullName(selected) : "— найти участника —"}
      </button>
      {open && (
        <div className="roster-picker-flyout">
          <input
            type="text"
            autoFocus
            placeholder="Начните вводить ник или позывной..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {filtered.length === 0 ? (
            <p className="hint-text">Никого не найдено.</p>
          ) : (
            filtered.map((m) => (
              <button
                type="button"
                key={m.discord_id}
                className="member-search-option"
                onClick={() => {
                  onSelect(m.discord_id);
                  setOpen(false);
                  setQuery("");
                }}
              >
                {m.avatar_url && <img src={m.avatar_url} alt="" className="member-avatar" />}
                {formatFullName(m)}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
