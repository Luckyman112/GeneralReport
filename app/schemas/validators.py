"""Общие проверки полей профиля участника — переиспользуются в схемах регистрации
и редактирования профиля (командиром/админом), чтобы формат ИДН/Steam ID был
одинаковым везде, где эти поля можно ввести вручную."""

import re

SERVICE_ID_RE = re.compile(r"^\d{4}$")
STEAM_ID_RE = re.compile(r"^STEAM_[0-5]:[01]:\d+$")
# SteamID64 — то, что возвращает подтверждённый вход через Steam (OpenID, см.
# app/core/steam_client.py); ручной ввод обычно даёт старый формат STEAM_X:Y:Z,
# поэтому оба варианта допустимы
STEAM_ID64_RE = re.compile(r"^\d{17}$")


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
    if not (STEAM_ID_RE.match(value) or STEAM_ID64_RE.match(value)):
        raise ValueError("Steam ID должен быть в формате STEAM_0:0:214977435 (или подтверждён входом через Steam)")
    return value
