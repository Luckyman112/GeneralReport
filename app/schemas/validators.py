"""Общие проверки полей профиля участника — переиспользуются в схемах регистрации
и редактирования профиля (командиром/админом), чтобы формат ИДН/Steam ID был
одинаковым везде, где эти поля можно ввести вручную."""

import re

SERVICE_ID_RE = re.compile(r"^\d{4}$")
STEAM_ID_RE = re.compile(r"^STEAM_[0-5]:[01]:\d+$")
# SteamID64 — то, что возвращает подтверждённый вход через Steam (OpenID, см.
# app/core/steam_client.py); ручной ввод обычно даёт старый формат STEAM_X:Y:Z,
# поэтому оба варианта допустимы на вход, но храним всегда STEAM_X:Y:Z (см.
# steamid64_to_steam2 ниже) — так ссылка на профиль строится единообразно
# везде (см. решение пользователя, frontend/src/utils/steam.js::steamProfileUrl)
STEAM_ID64_RE = re.compile(r"^\d{17}$")

_STEAM64_BASE = 76561197960265728


def steamid64_to_steam2(steamid64: str) -> str:
    """SteamID64 -> STEAM_0:Y:Z (см. https://developer.valvesoftware.com/wiki/SteamID)."""
    diff = int(steamid64) - _STEAM64_BASE
    y = diff % 2
    z = diff // 2
    return f"STEAM_0:{y}:{z}"


def validate_service_id(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    if not value:
        return None
    if not SERVICE_ID_RE.match(value):
        raise ValueError("ИДН должен состоять ровно из 4 цифр")
    return value


def validate_steam_id(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    if not value:
        return None
    if STEAM_ID64_RE.match(value):
        return steamid64_to_steam2(value)
    if not STEAM_ID_RE.match(value):
        raise ValueError("Steam ID должен быть в формате STEAM_0:0:214977435 (или подтверждён входом через Steam)")
    return value
