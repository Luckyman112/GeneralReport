import { useMemo, useState } from "react";

export const PERIOD_PRESETS = [
  { key: "week", label: "Неделя" },
  { key: "month", label: "Месяц" },
  { key: "all", label: "Всё время" },
  { key: "custom", label: "Свои даты" },
];

/** Лёгкий period-фильтр для списков внутри профиля (рапорты/отчёты/заявки) —
 * не график (см. ActivityTrendPanel для графика), просто отсекает элементы
 * уже загруженного списка по дате на клиенте. Свой независимый period-state
 * на каждый вызов (см. решение пользователя: неделя/месяц/свой период —
 * там же, где сводка активности в профиле). */
export function usePeriodFilter(defaultPreset = "all") {
  const [preset, setPreset] = useState(defaultPreset);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const range = useMemo(() => {
    if (preset === "all") return null;
    const now = new Date();
    if (preset === "week" || preset === "month") {
      const since = new Date(now);
      since.setDate(since.getDate() - (preset === "week" ? 6 : 29));
      since.setHours(0, 0, 0, 0);
      return { since, until: now };
    }
    if (!customFrom || !customTo) return null;
    const since = new Date(`${customFrom}T00:00:00`);
    const until = new Date(`${customTo}T23:59:59`);
    if (until <= since) return null;
    return { since, until };
  }, [preset, customFrom, customTo]);

  // Без диапазона (period="всё время" или незаполненные "свои даты") —
  // ничего не отсекаем, показываем всё как раньше
  function isInPeriod(dateStr) {
    if (!range || !dateStr) return true;
    const t = new Date(dateStr).getTime();
    return t >= range.since.getTime() && t <= range.until.getTime();
  }

  return { preset, setPreset, customFrom, setCustomFrom, customTo, setCustomTo, isInPeriod };
}
