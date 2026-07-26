"""Журнал действий администратора/высшего командования — кто что поменял в "чужой
зоне" (выговоры, тюнинг выслуги, чужой профиль, оверрайд критериев, решения по
повышению, бэкапы). Строго администратор."""
from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AccessContext, get_access_context
from app.crud import audit_log as audit_log_crud
from app.database import get_db
from app.exceptions import ForbiddenError
from app.schemas.audit_log import AuditLogRead

router = APIRouter(prefix="/admin/audit-log", tags=["audit-log"])


@router.get("", response_model=list[AuditLogRead])
async def list_audit_log(
    action: str | None = Query(default=None),
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[AuditLogRead]:
    if not access.is_admin:
        raise ForbiddenError("Журнал действий доступен только администратору")
    entries = await audit_log_crud.list_recent(
        db, limit=limit, action=action, date_from=date_from, date_to=date_to
    )
    return [AuditLogRead.model_validate(e) for e in entries]
