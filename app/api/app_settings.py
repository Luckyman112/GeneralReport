"""Настройки ролей (админ/командир/зам) — доступны только при входе по паролю,
даже у обычных Discord-администраторов доступа сюда нет."""
import logging

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AccessContext, get_access_context
from app.crud import app_settings as app_settings_crud
from app.database import get_db
from app.exceptions import ForbiddenError
from app.schemas.app_settings import AppSettingsRead, AppSettingsUpdate

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
    )
    logger.info("Настройки ролей обновлены через вход по паролю: %s", payload)
    return AppSettingsRead.model_validate(row)
