"""Выпуск и проверка JWT-токенов сессии."""
from datetime import datetime, timedelta, timezone

from jose import JWTError, jwt

from app.config import settings
from app.exceptions import UnauthorizedError


def create_access_token(user_id: int, discord_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {"sub": str(user_id), "discord_id": discord_id, "exp": expire}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError as exc:
        raise UnauthorizedError("Недействительный или истёкший токен сессии") from exc
