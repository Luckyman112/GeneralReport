/** Полное имя для отображения в рапортах: "ИДН Звание Позывной", если всё задано,
 * иначе — веб-ник или обычное имя пользователя. */
export function formatFullName(user) {
  if (!user) return "";
  if (user.service_id && user.rank && user.callsign) {
    return `${user.service_id} ${user.rank.code} ${user.callsign}`;
  }
  return user.nickname_override || user.username;
}
