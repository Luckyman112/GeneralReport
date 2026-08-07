"""Выпуск и проверка JWT-токенов сессии."""
from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt

from app.config import settings
from app.exceptions import UnauthorizedError


def create_access_token(user_id: int, discord_id: str) -> str:
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {"sub": str(user_id), "discord_id": discord_id, "exp": expire, "iat": now}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError as exc:
        raise UnauthorizedError("Недействительный или истёкший токен сессии") from exc


# Короткоживущий одноразовый токен для входа через Steam (app/api/steam.py) —
# передаётся Steam'у в openid.return_to и приходит назад с редиректом, поэтому
# не переиспользуем полноценный access_token (тот живёт сутки и не должен
# светиться в URL/логах чужого сервера дольше, чем нужно).
def create_steam_link_token(user_id: int) -> str:
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=10)
    payload = {"sub": str(user_id), "purpose": "steam_link", "exp": expire, "iat": now}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_steam_link_token(token: str) -> int:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError as exc:
        raise UnauthorizedError("Ссылка подтверждения Steam недействительна или устарела") from exc
    if payload.get("purpose") != "steam_link":
        raise UnauthorizedError("Недействительный токен подтверждения Steam")
    return int(payload["sub"])
