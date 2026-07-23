"""Общие зависимости FastAPI: подключение к БД, текущий пользователь, уровень доступа."""
from dataclasses import dataclass, field

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.constants import PASSWORD_LOGIN_DISCORD_ID
from app.core.security import decode_access_token
from app.crud import app_settings as app_settings_crud
from app.crud import regiment as regiment_crud
from app.crud import regiment_commander as regiment_commander_crud
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
    # Вход по общему паролю (не через Discord) — используется только для доступа
    # к странице настроек ролей, не смешивается с обычным is_admin
    is_password_login: bool
    # Формирования, где пользователь — командир или заместитель (видит все рапорты,
    # может одобрять/отклонять/удалять)
    commander_regiment_ids: set[int] = field(default_factory=set)
    # Из commander_regiment_ids — только те, где назначение именно "командир"
    # (может ещё заводить/удалять категории рапортов; у заместителя этого права нет)
    category_manager_regiment_ids: set[int] = field(default_factory=set)
    # Формирования, где пользователь — боец (видит только свои рапорты)
    soldier_regiment_ids: set[int] = field(default_factory=set)

    @property
    def has_access(self) -> bool:
        return self.is_admin or bool(self.commander_regiment_ids) or bool(self.soldier_regiment_ids)

    def is_commander_of(self, regiment_id: int) -> bool:
        return self.is_admin or regiment_id in self.commander_regiment_ids

    def is_full_commander_of(self, regiment_id: int) -> bool:
        """Полноправный командир (не заместитель) — может заводить/удалять категории
        рапортов и выставлять баллы."""
        return self.is_admin or regiment_id in self.category_manager_regiment_ids

    def can_manage_categories(self, regiment_id: int) -> bool:
        return self.is_full_commander_of(regiment_id)


async def get_access_context(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AccessContext:
    is_password_login = user.discord_id == PASSWORD_LOGIN_DISCORD_ID
    role_ids = set(user.roles)

    app_config = await app_settings_crud.get(db)
    is_admin = is_password_login or (app_config.admin_role_id in role_ids)
    has_commander_role = app_config.commander_role_id in role_ids or app_config.deputy_role_id in role_ids

    # Явные назначения "этот discord_id командует этим конкретным формированием" —
    # нужны, чтобы у человека с ролями сразу нескольких формирований (плюс общая роль
    # "Командир"/"Заместитель") не появлялись командирские права сразу во всех них.
    assignments_by_regiment: dict[int, str] = {}
    if has_commander_role:
        assignments_by_regiment = {
            rc.regiment_id: rc.role_type
            for rc in await regiment_commander_crud.get_all(db)
            if rc.discord_id == user.discord_id
        }

    commander_regiment_ids: set[int] = set()
    category_manager_regiment_ids: set[int] = set()
    soldier_regiment_ids: set[int] = set()

    for regiment in await regiment_crud.get_all(db):
        if regiment.discord_role_id not in role_ids:
            continue
        soldier_regiment_ids.add(regiment.id)
        role_type = assignments_by_regiment.get(regiment.id)
        if role_type is not None:
            commander_regiment_ids.add(regiment.id)
            if role_type == "commander":
                category_manager_regiment_ids.add(regiment.id)

    return AccessContext(
        user=user,
        is_admin=is_admin,
        is_password_login=is_password_login,
        commander_regiment_ids=commander_regiment_ids,
        category_manager_regiment_ids=category_manager_regiment_ids,
        soldier_regiment_ids=soldier_regiment_ids,
    )
