"""Режим обслуживания сайта — статус читается без авторизации (баннер должен быть
виден даже до входа), включение/выключение — только администратор."""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AccessContext, get_access_context
from app.core.events import event_bus
from app.crud import app_settings as app_settings_crud
from app.database import get_db
from app.exceptions import ForbiddenError
from app.schemas.maintenance import MaintenanceStatusRead, MaintenanceUpdate

router = APIRouter(tags=["maintenance"])


@router.get("/maintenance-status", response_model=MaintenanceStatusRead)
async def get_maintenance_status(db: AsyncSession = Depends(get_db)) -> MaintenanceStatusRead:
    row = await app_settings_crud.get(db)
    return MaintenanceStatusRead(enabled=row.maintenance_mode, message=row.maintenance_message)


@router.patch("/admin/maintenance", response_model=MaintenanceStatusRead)
async def update_maintenance(
    payload: MaintenanceUpdate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> MaintenanceStatusRead:
    if not access.is_admin:
        raise ForbiddenError("Режим обслуживания может менять только администратор")
    row = await app_settings_crud.set_maintenance_mode(db, enabled=payload.enabled, message=payload.message)
    event_bus.publish("maintenance")
    return MaintenanceStatusRead(enabled=row.maintenance_mode, message=row.maintenance_message)
