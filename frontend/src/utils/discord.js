/** Ссылка на профиль/ЛС в Discord по discord_id — открывает приложение
 * (или веб-клиент), если установлено. */
export function discordProfileUrl(discordId) {
  return discordId ? `https://discord.com/users/${discordId}` : null;
}
