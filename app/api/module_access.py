"""Кто может писать/видеть нарушения, рассылать объявления всем и видеть кнопку
"Рапорт о задержании" в разделе Рапортов — настраивает любой администратор (не
только вход по паролю, в отличие от app/api/app_settings.py)."""
import logging

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AccessContext, get_access_context
from app.crud import app_settings as app_settings_crud
from app.crud import audit_log as audit_log_crud
from app.database import get_db
from app.exceptions import ForbiddenError
from app.schemas.module_access import ModuleAccessRead, ModuleAccessUpdate

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


@router.patch("", response_model=ModuleAccessRead)
async def update_module_access(
    payload: ModuleAccessUpdate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> ModuleAccessRead:
    if not access.is_admin:
        raise ForbiddenError("Только администратор может настраивать доступ к модулям")
    changes = payload.model_dump(exclude_unset=True)
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
