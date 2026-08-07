"""Вход через Steam (OpenID 2.0) — подтверждает владение Steam-аккаунтом без
пароля и без API-ключа: пользователя редиректит на steamcommunity.com, Steam
возвращает подписанные параметры, которые мы перепроверяем обратным запросом
(openid.mode=check_authentication). Ключ Steam Web API тут не нужен — он бы
потребовался только для доп. данных (профиль/баны), которые пока не запрашиваем."""
import logging

from urllib.parse import urlencode

import httpx

logger = logging.getLogger(__name__)

STEAM_OPENID_URL = "https://steamcommunity.com/openid/login"
_CLAIMED_ID_PREFIX = "https://steamcommunity.com/openid/id/"


def build_login_url(return_to: str, realm: str) -> str:
    params = {
        "openid.ns": "http://specs.openid.net/auth/2.0",
        "openid.mode": "checkid_setup",
        "openid.return_to": return_to,
        "openid.realm": realm,
        "openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
        "openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
    }
    return f"{STEAM_OPENID_URL}?{urlencode(params)}"


async def verify_callback(params: dict) -> str | None:
    """Проверяет ответ Steam. Возвращает SteamID64 или None при неудаче/отмене."""
    if params.get("openid.mode") != "id_res":
        return None

    verify_params = dict(params)
    verify_params["openid.mode"] = "check_authentication"

    async with httpx.AsyncClient() as client:
        response = await client.post(STEAM_OPENID_URL, data=verify_params)

    if response.status_code != 200 or "is_valid:true" not in response.text:
        logger.warning("Steam OpenID verification failed: %s", response.text[:200])
        return None

    claimed_id = params.get("openid.claimed_id", "")
    if not claimed_id.startswith(_CLAIMED_ID_PREFIX):
        return None
    steam_id64 = claimed_id[len(_CLAIMED_ID_PREFIX):]
    return steam_id64 if steam_id64.isdigit() and len(steam_id64) == 17 else None
