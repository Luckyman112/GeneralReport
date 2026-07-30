import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { SearchIcon } from "./icons";
import { formatFullName } from "../utils/formatName";

const MIN_QUERY_LENGTH = 2;
const MAX_RESULTS = 12;

/** Быстрый поиск бойца по всему сайту (ИДН/позывной/ник) — по клику сразу
 * переходит в "Рапорты" с открытой карточкой этого бойца в нужном формировании. */
export function GlobalSearch() {
  const { token, regiments } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [membersByRegiment, setMembersByRegiment] = useState(null);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function handleOutsideClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [open]);

  // Список состава всех формирований подтягиваем один раз при открытии поиска —
  // дальше фильтруем локально, без запроса на каждый ввод символа
  function handleOpen() {
    setOpen(true);
    if (membersByRegiment !== null) return;
    setLoading(true);
    Promise.all(
      regiments.map((r) =>
        api
          .getMembers(token, r.id)
          .then((members) => [r, members])
          .catch(() => [r, []])
      )
    )
      .then((pairs) => setMembersByRegiment(pairs))
      .finally(() => setLoading(false));
  }

  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!membersByRegiment || q.length < MIN_QUERY_LENGTH) return [];
    return membersByRegiment
      .flatMap(([regiment, members]) => members.map((m) => ({ regiment, member: m })))
      .filter(({ member: m }) => {
        const haystack = `${m.username} ${m.service_id || ""} ${m.callsign || ""}`.toLowerCase();
        return haystack.includes(q);
      })
      .slice(0, MAX_RESULTS);
  }, [membersByRegiment, q]);

  function handleSelect(regiment, member) {
    setOpen(false);
    setQuery("");
    navigate(`/reports?regiment=${regiment.id}&member=${member.discord_id}`);
  }

  return (
    <div className="global-search-wrap" ref={wrapRef}>
      <button type="button" className="ghost global-search-button" title="Найти бойца" onClick={handleOpen}>
        <SearchIcon />
      </button>

      {open && (
        <div className="global-search-flyout">
          <input
            type="text"
            autoFocus
            placeholder="ИДН, позывной или ник..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {loading ? (
            <p className="hint-text">Загрузка состава...</p>
          ) : q.length < MIN_QUERY_LENGTH ? (
            <p className="hint-text">Введите минимум {MIN_QUERY_LENGTH} символа.</p>
          ) : results.length === 0 ? (
            <p className="hint-text">Никого не найдено.</p>
          ) : (
            results.map(({ regiment, member }) => (
              <button
                type="button"
                key={`${regiment.id}-${member.discord_id}`}
                className="global-search-result"
                onClick={() => handleSelect(regiment, member)}
              >
                {(member.photo_url || member.avatar_url) && (
                  <img src={member.photo_url || member.avatar_url} alt="" className="member-avatar" />
                )}
                <span>{formatFullName(member)}</span>
                <span className="hint-text global-search-result-regiment">{regiment.name}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
