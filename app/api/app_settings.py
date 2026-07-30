"""Настройки ролей (админ/командир/зам) — доступны только при входе по паролю,
даже у обычных Discord-администраторов доступа сюда нет."""
import logging

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AccessContext, get_access_context
from app.core import discord_client
from app.crud import app_settings as app_settings_crud
from app.crud import audit_log as audit_log_crud
from app.database import get_db
from app.exceptions import ForbiddenError
from app.schemas.app_settings import AppSettingsRead, AppSettingsUpdate
from app.schemas.regiment_commander import GuildMemberRead

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/app-settings", tags=["app-settings"])


def _require_password_login(access: AccessContext) -> None:
    if not access.is_password_login:
        raise ForbiddenError("Настройки ролей доступны только при входе по паролю")


@router.get("", response_model=AppSettingsRead)
async def get_app_settings(
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> AppSettingsRead:
    _require_password_login(access)
    row = await app_settings_crud.get(db)
    return AppSettingsRead.model_validate(row)


@router.patch("", response_model=AppSettingsRead)
async def update_app_settings(
    payload: AppSettingsUpdate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> AppSettingsRead:
    _require_password_login(access)
    row = await app_settings_crud.update(
        db,
        admin_role_id=payload.admin_role_id,
        commander_role_id=payload.commander_role_id,
        deputy_role_id=payload.deputy_role_id,
        high_command_role_id=payload.high_command_role_id,
        admin_user_discord_ids=payload.admin_user_discord_ids,
        founder_role_id=payload.founder_role_id,
        instructor_role_id=payload.instructor_role_id,
        password_login_authorized_discord_id=payload.password_login_authorized_discord_id,
    )
    logger.info("Настройки ролей обновлены через вход по паролю: %s", payload)
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=True,
        action="settings_roles_update",
        details=f"Изменены настройки ролей: {payload.model_dump(exclude_unset=True)}",
    )
    return AppSettingsRead.model_validate(row)


@router.get("/discord-members", response_model=list[GuildMemberRead])
async def get_discord_members(
    access: AccessContext = Depends(get_access_context),
) -> list[GuildMemberRead]:
    """Список участников сервера — для выбора конкретных людей администраторами
    (в дополнение к роли администратора)."""
    _require_password_login(access)
    members = await discord_client.fetch_guild_members()
    return [
        GuildMemberRead(
            discord_id=m["discord_id"],
            username=m["username"],
            discord_username=m["username"],
            avatar_url=m["avatar_url"],
        )
        for m in members
    ]
