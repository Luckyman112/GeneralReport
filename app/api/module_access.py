"""Кто может писать/видеть нарушения, рассылать объявления всем и видеть кнопку
"Рапорт о задержании" в разделе Рапортов — настраивает любой администратор (не
только вход по паролю, в отличие от app/api/app_settings.py)."""
import logging

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AccessContext, get_access_context
from app.core import discord_client
from app.crud import app_settings as app_settings_crud
from app.crud import audit_log as audit_log_crud
from app.database import get_db
from app.exceptions import ForbiddenError
from app.schemas.module_access import ModuleAccessRead, ModuleAccessUpdate
from app.schemas.regiment_commander import DiscordChannelRead

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/module-access", tags=["module-access"])


@router.get("", response_model=ModuleAccessRead)
async def get_module_access(
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> ModuleAccessRead:
    if not access.is_admin:
        raise ForbiddenError("Только администратор может настраивать доступ к модулям")
    row = await app_settings_crud.get(db)
    return ModuleAccessRead.model_validate(row)


@router.get("/discord-channels", response_model=list[DiscordChannelRead])
async def get_discord_channels(access: AccessContext = Depends(get_access_context)) -> list[DiscordChannelRead]:
    """Текстовые каналы сервера — для выбора канала уведомлений об ивентах."""
    if not access.is_admin:
        raise ForbiddenError("Только администратор может настраивать доступ к модулям")
    channels = await discord_client.fetch_guild_text_channels()
    return [DiscordChannelRead(id=c["id"], name=c["name"]) for c in channels]


@router.patch("", response_model=ModuleAccessRead)
async def update_module_access(
    payload: ModuleAccessUpdate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> ModuleAccessRead:
    if not access.is_admin:
        raise ForbiddenError("Только администратор может настраивать доступ к модулям")
    changes = payload.model_dump(exclude_unset=True)
    # единственные single-value nullable-строки в этом апдейте (остальные поля —
    # списки, где "" не бывает) — пустая строка из <select> "не выбрано" должна
    # стать NULL, а не буквально сохранённой пустой строкой
    for key in (
        "event_junior_role_id",
        "event_role_id",
        "event_senior_role_id",
        "event_assistant_role_id",
        "event_curator_role_id",
        "event_notify_channel_id",
        "event_notify_ping_role_id",
        "admin_staff_junior_role_id",
        "admin_staff_middle_role_id",
        "admin_staff_warden_role_id",
        "admin_staff_assistant_role_id",
        "admin_staff_curator_role_id",
    ):
        if key in changes:
            changes[key] = changes[key] or None
    row = await app_settings_crud.update_module_access(db, **changes)
    logger.info("%s обновил настройки доступа к модулям: %s", access.user.username, changes)
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=True,
        action="settings_module_access_update",
        details=f"Изменены настройки доступа к модулям: {changes}",
    )
    return ModuleAccessRead.model_validate(row)
