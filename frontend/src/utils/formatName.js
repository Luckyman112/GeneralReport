/** Полное имя для отображения в рапортах: "ИДН Звание Позывной", если всё задано,
 * иначе — веб-ник или обычное имя пользователя. */
export function formatFullName(user) {
  return formatFullNameAtRank(user, user?.rank);
}

/** То же самое, но со званием, зафиксированным на момент события (например,
 * author_rank/updated_by_rank рапорта) — используется в архивных местах, где
 * звание не должно "задним числом" меняться после последующих повышений. */
export function formatFullNameAtRank(user, rank) {
  if (!user) return "";
  if (user.service_id && rank && user.callsign) {
    return `${user.service_id} | ${rank.code} | ${user.callsign}`;
  }
  return user.nickname_override || user.username;
}
