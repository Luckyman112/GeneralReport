import { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import { useAuth } from "../../auth/AuthContext";
import { formatFullName } from "../../utils/formatName";
import { useToast } from "../ToastContext";
import { KindBadge, StatusChip } from "./RequestCard";
import { KINDS, KIND_ORDER, actionsFor, kindOf, statusOf } from "./requestModel";

const PAGE = 15;

// коротко для строки списка: «06.10 20:11» по МСК, без секунд и года
function shortMsk(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d
    .toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    .replace(",", "");
}

/** Компактный список заявок: вкладки со счётчиками, фильтр по типу, поиск и
 * подгрузка порциями — чтобы при сотнях заявок страница не превращалась в
 * простыню. Строка открывает окно просмотра со всеми действиями; на самой
 * строке — одна быстрая кнопка (отправить / одобрить / исправить). */
export function RequestList({ tabs, defaultTab, canDecide, onView, onEdit, onChanged }) {
  const [tab, setTab] = useState(defaultTab || tabs[0]?.key);
  const [kind, setKind] = useState("all");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(PAGE);

  // вкладка могла исчезнуть (например, у проверяющего опустела очередь)
  const current = tabs.find((t) => t.key === tab) || tabs[0];
  useEffect(() => setLimit(PAGE), [tab, kind, query]);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (current?.items || []).filter((ev) => {
      if (kind !== "all" && kindOf(ev) !== kind) return false;
      if (!q) return true;
      const author = ev.submitted_by ? formatFullName(ev.submitted_by).toLowerCase() : "";
      return ev.title.toLowerCase().includes(q) || author.includes(q);
    });
  }, [current, kind, query]);

  if (!current) return null;

  return (
    <div className="request-list-panel">
      <div className="request-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={t.key === current.key}
            className={`request-tab${t.key === current.key ? " active" : ""}${t.accent && t.items.length ? " accent" : ""}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            <span className="request-tab-count">{t.items.length}</span>
          </button>
        ))}
      </div>

      <div className="request-filters">
        <div className="request-kind-filter">
          <button type="button" className={kind === "all" ? "active" : ""} onClick={() => setKind("all")}>
            Все типы
          </button>
          {KIND_ORDER.map((k) => (
            <button key={k} type="button" className={kind === k ? "active" : ""} onClick={() => setKind(k)}>
              {KINDS[k].short}
            </button>
          ))}
        </div>
        <input
          type="search"
          className="request-search"
          placeholder="Поиск по названию или автору"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {items.length === 0 ? (
        <p className="request-empty">{query || kind !== "all" ? "Ничего не найдено." : current.empty || "Заявок нет."}</p>
      ) : (
        <div className="request-rows">
          {items.slice(0, limit).map((ev) => (
            <RequestRow
              key={ev.id}
              ev={ev}
              canDecide={canDecide}
              showAuthor={current.showAuthor}
              onView={onView}
              onEdit={onEdit}
              onChanged={onChanged}
            />
          ))}
        </div>
      )}
      {items.length > limit && (
        <button type="button" className="ghost request-more" onClick={() => setLimit((n) => n + PAGE)}>
          Показать ещё {Math.min(PAGE, items.length - limit)}
          {items.length - limit > PAGE ? ` · осталось ${items.length - limit}` : ""}
        </button>
      )}
    </div>
  );
}

function RequestRow({ ev, canDecide, showAuthor, onView, onEdit, onChanged }) {
  const { token, user } = useAuth();
  const showToast = useToast();
  const [busy, setBusy] = useState(false);
  const a = actionsFor(ev, user, canDecide);
  const isAuthor = ev.submitted_by?.id === user?.id;
  const start = ev.payload?.briefing_start;

  async function run(fn, ok) {
    setBusy(true);
    try {
      await fn();
      showToast(ok);
      onChanged?.();
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      setBusy(false);
    }
  }

  // одна быстрая кнопка — самое вероятное следующее действие
  let quick = null;
  if (a.send) {
    quick = (
      <button type="button" className="primary" disabled={busy} onClick={() => run(() => api.sendEvent(token, ev.id), "Отправлено в Discord")}>
        Отправить
      </button>
    );
  } else if (a.approve) {
    quick = (
      <button type="button" disabled={busy} onClick={() => run(() => api.approveEvent(token, ev.id), "Одобрено")}>
        Одобрить
      </button>
    );
  } else if (isAuthor && ev.status === "revision" && a.edit) {
    quick = (
      <button type="button" onClick={() => onEdit(ev)}>
        Исправить
      </button>
    );
  }

  return (
    <div
      className={`request-row rs-${statusOf(ev)}`}
      role="button"
      tabIndex={0}
      onClick={() => onView(ev)}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onView(ev))}
    >
      <KindBadge ev={ev} />
      <div className="request-row-main">
        <span className="request-row-title">{ev.title}</span>
        <span className="request-row-meta">
          {showAuthor && ev.submitted_by && <span>{formatFullName(ev.submitted_by)}</span>}
          <span>подана {shortMsk(ev.created_at)}</span>
          {start && <span>старт {shortMsk(start)} МСК</span>}
        </span>
        {ev.status === "revision" && ev.revision_comment && <span className="request-row-note">⚠ {ev.revision_comment}</span>}
      </div>
      <StatusChip ev={ev} />
      <div className="request-row-quick" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        {quick}
      </div>
    </div>
  );
}
