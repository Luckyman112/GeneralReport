import { emptyAudience } from "./fields";

/* Заявки Ивентрума: три типа в одном потоке (см. решение пользователя).
 * Бэкенд хранит общую часть (название, статус, автор), а набор полей каждого
 * типа лежит в payload — шаблон задаётся здесь, см. app/api/event_room.py. */

export const KINDS = {
  event: {
    label: "Заявка на ивент",
    short: "Ивент",
    hint: "Боевой вылет или операция: карточка-досье с задачами, составом и картой. Уходит в канал ивентов с пингом роли.",
  },
  rp: {
    label: "РП ивент",
    short: "РП",
    hint: "Сюжетный ивент: что происходит, где и кто участвует. Уходит в канал ивентов с пингом роли.",
  },
  mini: {
    label: "Миник",
    short: "Миник",
    hint: "Сообщение «на коммуникатор бойцов» от лица персонажа. Уходит в канал коммуникатора без пинга.",
  },
};

export const KIND_ORDER = ["event", "rp", "mini"];

export function kindOf(ev) {
  return KINDS[ev.kind] ? ev.kind : "event";
}

/** Статус для показа: «одобрено» делится на «можно отправить» и «отправлено». */
export function statusOf(ev) {
  if (ev.status === "approved") return ev.notified_at ? "sent" : "approved";
  return ev.status;
}

export const STATUS_INFO = {
  pending: { label: "На рассмотрении", tone: "pending" },
  revision: { label: "Нужна правка", tone: "revision" },
  approved: { label: "Одобрено — можно отправить", tone: "approved" },
  sent: { label: "Отправлено", tone: "sent" },
  rejected: { label: "Отклонено", tone: "rejected" },
  cancelled: { label: "Отменено", tone: "rejected" },
};

/** Что можно сделать с заявкой — одно место для карточки и окна просмотра. */
export function actionsFor(ev, user, canDecide) {
  const isAuthor = ev.submitted_by?.id === user?.id;
  const open = ev.status === "pending" || ev.status === "revision";
  return {
    edit: ev.status !== "cancelled" && (canDecide || (isAuthor && open)),
    send: ev.status === "approved" && !ev.notified_at && (isAuthor || canDecide),
    approve: canDecide && open,
    revision: canDecide && open,
    reject: canDecide && open,
    cancel: canDecide && ev.status === "approved",
    messages: ev.status === "approved" && kindOf(ev) === "event" && (isAuthor || canDecide),
  };
}

/** Архив — решение окончательное или ивент уже прошёл. */
export function isArchived(ev) {
  if (ev.status === "cancelled" || ev.status === "rejected") return true;
  const start = ev.payload?.briefing_start;
  if (start && new Date(start).getTime() < Date.now() - 6 * 3600 * 1000) return true;
  // отправленный миник без даты — прошлое через сутки
  if (kindOf(ev) === "mini" && ev.notified_at) {
    return new Date(ev.notified_at).getTime() < Date.now() - 24 * 3600 * 1000;
  }
  return false;
}

export function mskNowTime() {
  return new Date().toLocaleTimeString("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" });
}

/** Текст миника — совпадает с app/api/event_room.py::format_mini_message. */
export function formatMini(p) {
  const v = (k) => String(p?.[k] || "").trim();
  return (
    "[ На коммуникатор бойцов пришло сообщение ]\n\n" +
    `От кого: ${v("sender")}\n` +
    `Кому: ${v("recipient")}\n\n` +
    `Сообщение: ${v("message")}\n\n` +
    `[Время: ${v("time")}]`
  );
}

export function emptyForm(kind) {
  const base = { title: "", briefing_start: "", booking_id: "" };
  if (kind === "mini") return { ...base, sender: "", recipient: "", message: "", time: mskNowTime() };
  if (kind === "rp") {
    return { ...base, summary: "", planet_name: "", participants: emptyAudience(), notes: "" };
  }
  return {
    ...base,
    summary: "",
    objective: "",
    tasks: [""],
    extraTasks: [""],
    threat: "",
    participants: emptyAudience(),
    attached: emptyAudience(),
    commander_discord_id: "",
    map_id: "",
    map_image_url: "",
    planet_name: "",
    star_system: "",
    landscape: "",
    weather: "",
    flora_fauna: "",
  };
}

function audienceToPayload(a, optional) {
  if (!a) return null;
  if (a.mode === "role") {
    if (optional && !a.regiment_id && !a.custom_name) return null;
    return {
      mode: "role",
      regiment_id: a.custom_name ? null : a.regiment_id,
      custom_name: a.custom_name || null,
    };
  }
  if (optional && !a.discord_ids.length) return null;
  return { mode: "people", discord_ids: a.discord_ids };
}

const trim = (v) => (typeof v === "string" ? v.trim() : v) || null;

/** Тело запроса на создание/правку: {title, kind, payload}. */
export function formToBody(kind, form) {
  if (kind === "mini") {
    const title = form.title.trim() || `Сообщение от ${form.sender.trim() || "персонажа"}`;
    return {
      title: title.slice(0, 255),
      kind,
      payload: {
        sender: form.sender.trim(),
        recipient: form.recipient.trim(),
        message: form.message.trim(),
        time: form.time.trim(),
      },
    };
  }
  if (kind === "rp") {
    return {
      title: form.title.trim(),
      kind,
      payload: {
        summary: trim(form.summary),
        planet_name: trim(form.planet_name),
        briefing_start: form.briefing_start || null,
        participants: audienceToPayload(form.participants, true),
        notes: trim(form.notes),
        booking_id: form.booking_id ? Number(form.booking_id) : null,
      },
    };
  }
  return {
    title: form.title.trim(),
    kind,
    payload: {
      summary: trim(form.summary),
      objective: trim(form.objective),
      tasks: form.tasks.map((t) => t.trim()).filter(Boolean),
      extra_tasks: form.extraTasks.map((t) => t.trim()).filter(Boolean),
      threat: trim(form.threat),
      briefing_start: form.briefing_start || null,
      participants: audienceToPayload(form.participants, false),
      attached: audienceToPayload(form.attached, true),
      commander_discord_id: form.commander_discord_id || null,
      map_id: form.map_id ? Number(form.map_id) : null,
      map_image_url: form.map_image_url || null,
      planet_name: trim(form.planet_name),
      star_system: trim(form.star_system),
      landscape: trim(form.landscape),
      weather: trim(form.weather),
      flora_fauna: trim(form.flora_fauna),
      booking_id: form.booking_id ? Number(form.booking_id) : null,
    },
  };
}

/** Форма из сохранённой заявки — для правки. */
export function eventToForm(ev) {
  const kind = kindOf(ev);
  const p = ev.payload || {};
  const base = emptyForm(kind);
  if (kind === "mini") {
    return { ...base, title: ev.title, sender: p.sender || "", recipient: p.recipient || "", message: p.message || "", time: p.time || "" };
  }
  const common = {
    title: ev.title,
    briefing_start: p.briefing_start || "",
    booking_id: p.booking_id ? String(p.booking_id) : "",
    summary: p.summary || "",
    planet_name: p.planet_name || "",
    participants: { ...emptyAudience(), ...(p.participants || {}) },
  };
  if (kind === "rp") return { ...base, ...common, notes: p.notes || "" };
  return {
    ...base,
    ...common,
    objective: p.objective || "",
    tasks: p.tasks?.length ? p.tasks : [""],
    extraTasks: p.extra_tasks?.length ? p.extra_tasks : [""],
    threat: p.threat || "",
    attached: { ...emptyAudience(), ...(p.attached || {}) },
    commander_discord_id: p.commander_discord_id || "",
    map_id: p.map_id ? String(p.map_id) : "",
    map_image_url: p.map_image_url || "",
    star_system: p.star_system || "",
    landscape: p.landscape || "",
    weather: p.weather || "",
    flora_fauna: p.flora_fauna || "",
  };
}

/** Можно ли подать: минимально обязательные поля по типу. */
export function formIsValid(kind, form) {
  if (kind === "mini") return Boolean(form.sender.trim() && form.recipient.trim() && form.message.trim());
  return Boolean(form.title.trim());
}
