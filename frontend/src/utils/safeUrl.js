/** Возвращает url, только если его схема http/https — иначе null. Формирования
 * настраивают discord_channel_url сами (RegimentConfigModal), и он рендерится как
 * <a href> в нескольких местах; без этой проверки командир мог бы вписать
 * javascript:... и получить XSS у всех, кто откроет карточку состава. */
export function safeUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.href;
  } catch {
    return null;
  }
}
