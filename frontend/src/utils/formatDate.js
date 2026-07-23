// Все даты показываем по МСК, независимо от часового пояса браузера просматривающего
export function formatMskDate(value) {
  return new Date(value).toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
}
