import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { EventActivityReports } from "../components/EventActivityReports";
import { EventBookingCalendar } from "../components/EventBookingCalendar";
import { InlineSpinner } from "../components/InlineSpinner";
import { RequestList } from "../components/eventroom/RequestList";
import { RequestDetailsModal } from "../components/eventroom/RequestDetailsModal";
import { RequestFormModal } from "../components/eventroom/RequestFormModal";
import { RosterPanel } from "../components/eventroom/RosterPanel";
import { isArchived, statusOf } from "../components/eventroom/requestModel";

function emptyMapForm() {
  return { id: null, name: "", url: "" };
}

function mapToForm(m) {
  return { id: m.id, name: m.name, url: m.url || "" };
}

/** Карта каталога — название и ссылка попадают в карточку операции в Discord. */
function MapForm({ initial, onSubmit, onCancel }) {
  const [form, setForm] = useState(initial);
  const setField = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));
  return (
    <div className="picker-row" style={{ flexWrap: "wrap" }}>
      <input type="text" placeholder="Название карты" value={form.name} onChange={(e) => setField("name", e.target.value)} />
      <input type="text" placeholder="Ссылка на карту" value={form.url} onChange={(e) => setField("url", e.target.value)} />
      <button type="button" disabled={!form.name.trim()} onClick={() => onSubmit(form)}>
        {form.id ? "Сохранить" : "Добавить карту"}
      </button>
      <button type="button" className="ghost" onClick={onCancel}>
        Отмена
      </button>
    </div>
  );
}

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** Ивентрум. Заявки трёх типов (ивент, РП ивент, миник) идут одним потоком:
 * подача → рассмотрение (одобрить / вернуть на редакцию с замечанием /
 * отклонить) → после одобрения автор сам отправляет её в Discord. Куратор и
 * ассистент могут править заявку когда угодно, автор — пока она не одобрена. */
export function EventRoomPage() {
  const { token, user, access, regiments } = useAuth();
  const [events, setEvents] = useState([]);
  const [maps, setMaps] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [formFor, setFormFor] = useState(null); // null | { editing: ev | null }
  const [viewId, setViewId] = useState(null);
  const [mapDraft, setMapDraft] = useState(null);

  const canDecide = Boolean(access?.can_decide_event);
  const canSubmit = Boolean(access?.is_event_submitter);

  const load = useCallback(() => {
    return Promise.all([api.listEvents(token), api.listEventMaps(token), api.getEventMemberCandidates(token)])
      .then(([eventsData, mapsData, membersData]) => {
        setEvents(eventsData);
        setMaps(mapsData);
        setMembers(membersData);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const mine = useMemo(() => events.filter((e) => e.submitted_by?.id === user?.id), [events, user]);
  const myActive = useMemo(() => mine.filter((e) => !isArchived(e)), [mine]);
  const byNewest = (a, b) => new Date(b.created_at) - new Date(a.created_at);

  // Вкладки списка. Очередь — по порядку подачи (кто раньше подал, того раньше
  // смотрят), остальное — свежие сверху.
  const tabs = useMemo(() => {
    const active = events.filter((e) => !isArchived(e));
    if (canDecide) {
      return [
        {
          key: "queue",
          label: "На рассмотрении",
          accent: true,
          showAuthor: true,
          empty: "Нет заявок, ожидающих решения.",
          items: active
            .filter((e) => e.status === "pending" || e.status === "revision")
            .sort((a, b) => new Date(a.created_at) - new Date(b.created_at)),
        },
        {
          key: "to-send",
          label: "Ждут отправки",
          showAuthor: true,
          empty: "Все одобренные заявки отправлены.",
          items: active.filter((e) => statusOf(e) === "approved").sort(byNewest),
        },
        {
          key: "sent",
          label: "Отправленные",
          showAuthor: true,
          empty: "Пока ничего не отправлено.",
          items: active.filter((e) => statusOf(e) === "sent").sort(byNewest),
        },
        {
          key: "mine",
          label: "Мои",
          empty: "Своих активных заявок нет.",
          items: [...myActive].sort(byNewest),
        },
        {
          key: "archive",
          label: "Архив",
          showAuthor: true,
          empty: "Архив пуст.",
          items: events.filter(isArchived).sort(byNewest),
        },
      ];
    }
    return [
      { key: "active", label: "Активные", empty: "Активных заявок нет. Нажмите «+ Новая заявка».", items: [...myActive].sort(byNewest) },
      { key: "archive", label: "Архив", empty: "Архив пуст.", items: mine.filter(isArchived).sort(byNewest) },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, mine, myActive, canDecide]);
  const defaultTab = canDecide ? (tabs[0].items.length ? "queue" : "mine") : "active";

  // активные уведомления автору: что требует его действия
  const needFix = myActive.filter((e) => e.status === "revision");
  const toSend = myActive.filter((e) => statusOf(e) === "approved");

  const viewing = events.find((e) => e.id === viewId);

  async function handleSaveMap(form) {
    if (!form.name.trim()) return;
    const body = { name: form.name.trim(), url: form.url.trim() };
    try {
      if (form.id) await api.updateEventMap(token, form.id, body);
      else await api.createEventMap(token, body);
      setMapDraft(null);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleDeleteMap(id) {
    try {
      await api.deleteEventMap(token, id);
      load();
    } catch (e) {
      setError(e.message);
    }
  }

  if (loading) return <InlineSpinner />;

  return (
    <div className="page-container">
      <div className="eventroom-head">
        <div>
          <h2>Ивентрум</h2>
          <p className="hint-text">
            Заявка на ивент, РП ивент или миник: подаёте → Ассистент/Куратор одобряет или возвращает с замечанием → вы
            отправляете в Discord.
          </p>
        </div>
        {canSubmit && (
          <button className="primary" type="button" onClick={() => setFormFor({ editing: null })}>
            + Новая заявка
          </button>
        )}
      </div>

      {error && <p className="error-text">{error}</p>}

      {(needFix.length > 0 || toSend.length > 0) && (
        <div className="eventroom-alerts">
          {needFix.length > 0 && (
            <button type="button" className="eventroom-alert tone-revision" onClick={() => setViewId(needFix[0].id)}>
              {needFix.length} {plural(needFix.length, "заявку вернули", "заявки вернули", "заявок вернули")} на правку — посмотреть замечание
            </button>
          )}
          {toSend.length > 0 && (
            <button type="button" className="eventroom-alert tone-approved" onClick={() => setViewId(toSend[0].id)}>
              {toSend.length} {plural(toSend.length, "заявка одобрена", "заявки одобрены", "заявок одобрено")} и ждёт отправки в Discord
            </button>
          )}
        </div>
      )}

      {(canSubmit || canDecide) && (
        <section className="regiment-panel">
          <h3>Заявки</h3>
          <RequestList
            tabs={tabs}
            defaultTab={defaultTab}
            canDecide={canDecide}
            onView={(ev) => setViewId(ev.id)}
            onEdit={(ev) => setFormFor({ editing: ev })}
            onChanged={load}
          />
        </section>
      )}

      {canDecide && (
        <details className="regiment-panel eventroom-archive">
          <summary>
            Карты для заявок <span className="category-points-badge">{maps.length}</span>
          </summary>
          {maps.length > 0 && (
            <ul className="chip-list">
              {maps.map((m) => (
                <li key={m.id} className="chip">
                  {m.name}
                  <button type="button" onClick={() => setMapDraft(mapToForm(m))} title="Изменить">
                    ✎
                  </button>
                  <button type="button" onClick={() => handleDeleteMap(m.id)} title="Удалить">
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          {mapDraft ? (
            <MapForm initial={mapDraft} onSubmit={handleSaveMap} onCancel={() => setMapDraft(null)} />
          ) : (
            <button type="button" className="ghost" onClick={() => setMapDraft(emptyMapForm())}>
              + Добавить карту
            </button>
          )}
        </details>
      )}

      {canDecide && <RosterPanel />}

      <EventBookingCalendar />
      <EventActivityReports />

      {formFor && (
        <RequestFormModal
          editing={formFor.editing}
          maps={maps}
          regiments={regiments}
          members={members}
          onClose={() => setFormFor(null)}
          onSaved={() => {
            setFormFor(null);
            load();
          }}
        />
      )}
      {viewing && (
        <RequestDetailsModal
          ev={viewing}
          canDecide={canDecide}
          regiments={regiments}
          members={members}
          maps={maps}
          onClose={() => setViewId(null)}
          onChanged={load}
          onEdit={(ev) => setFormFor({ editing: ev })}
        />
      )}
    </div>
  );
}
