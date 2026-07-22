"""Общие зависимости FastAPI: подключение к БД, текущий пользователь, уровень доступа."""
from dataclasses import dataclass, field

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.security import decode_access_token
from app.crud import regiment as regiment_crud
from app.crud import user as user_crud
from app.database import get_db
from app.exceptions import UnauthorizedError
from app.models.user import User

bearer_scheme = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    payload = decode_access_token(credentials.credentials)
    user = await user_crud.get_by_id(db, int(payload["sub"]))
    if user is None:
        raise UnauthorizedError("Пользователь не найден, войдите заново")
    return user


@dataclass
class AccessContext:
    """Вычисленный уровень доступа пользователя на основе его Discord-ролей."""

    user: User
    is_admin: bool
    # Формирования, где пользователь — командир (видит все рапорты формирования)
    commander_regiment_ids: set[int] = field(default_factory=set)
    # Формирования, где пользователь — боец (видит только свои рапорты)
    soldier_regiment_ids: set[int] = field(default_factory=set)

    @property
    def has_access(self) -> bool:
        return self.is_admin or bool(self.commander_regiment_ids) or bool(self.soldier_regiment_ids)

    def is_commander_of(self, regiment_id: int) -> bool:
        return self.is_admin or regiment_id in self.commander_regiment_ids


async def get_access_context(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AccessContext:
    role_ids = set(user.roles)
    is_admin = settings.admin_role_id in role_ids
    has_commander_role = settings.commander_role_id in role_ids

    commander_regiment_ids: set[int] = set()
    soldier_regiment_ids: set[int] = set()

    for regiment in await regiment_crud.get_all(db):
        if regiment.discord_role_id not in role_ids:
            continue
        soldier_regiment_ids.add(regiment.id)
        # Командир формирования = общая роль "Командир" + роль самого формирования
        if has_commander_role:
            commander_regiment_ids.add(regiment.id)

    return AccessContext(
        user=user,
        is_admin=is_admin,
        commander_regiment_ids=commander_regiment_ids,
        soldier_regiment_ids=soldier_regiment_ids,
    )
