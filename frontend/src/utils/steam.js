const STEAM_ID_RE = /^STEAM_[0-5]:([01]):(\d+)$/;
const STEAM_ID64_RE = /^\d{17}$/;
const STEAM64_BASE = 76561197960265728n;

/** Конвертирует Steam2 ID (STEAM_0:Y:Z) или уже SteamID64 (17 цифр) в ссылку на
 * профиль Steam Community, или null, если строка не в узнаваемом формате.
 * Бэкенд нормализует ввод в STEAM_X:Y:Z при валидации (см.
 * app/schemas/validators.py::validate_steam_id), но строки, попавшие в базу до
 * этой нормализации (или напрямую через восстановление бэкапа), могут остаться
 * в формате SteamID64 — здесь эта форма тоже принимается, чтобы ссылка не
 * ломалась независимо от истории конкретной записи. */
export function steamProfileUrl(steamId) {
  if (!steamId) return null;
  const trimmed = steamId.trim();
  if (STEAM_ID64_RE.test(trimmed)) {
    return `https://steamcommunity.com/profiles/${trimmed}`;
  }
  const match = STEAM_ID_RE.exec(trimmed);
  if (!match) return null;
  const y = BigInt(match[1]);
  const z = BigInt(match[2]);
  const id64 = STEAM64_BASE + z * 2n + y;
  return `https://steamcommunity.com/profiles/${id64.toString()}`;
}
