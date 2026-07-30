const STEAM_ID_RE = /^STEAM_[0-5]:([01]):(\d+)$/;
const STEAM64_BASE = 76561197960265728n;

/** Конвертирует Steam2 ID (STEAM_0:Y:Z) в ссылку на профиль Steam Community —
 * https://developer.valvesoftware.com/wiki/SteamID#Conversion_from_SteamID_to_SteamID64,
 * или null, если строка не в узнаваемом формате. */
export function steamProfileUrl(steamId) {
  if (!steamId) return null;
  const match = STEAM_ID_RE.exec(steamId.trim());
  if (!match) return null;
  const y = BigInt(match[1]);
  const z = BigInt(match[2]);
  const id64 = STEAM64_BASE + z * 2n + y;
  return `https://steamcommunity.com/profiles/${id64.toString()}`;
}
