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
from app.models.specialization import DISCIPLINE_CATEGORIES
from app.schemas.audit_log import AuditLogRead

router = APIRouter(prefix="/admin/audit-log", tags=["audit-log"])

# Действия по специализациям — единственное, что видит DEP/CU без полного
# админского доступа к журналу (и только по своей дисциплине, см. ниже)
_DISCIPLINE_ACTIONS = ["specialization_grant", "specialization_revoke", "specialization_ban_create"]


@router.get("", response_model=list[AuditLogRead])
async def list_audit_log(
    action: str | None = Query(default=None),
    date_from: datetime | None = Query(default=None),
    date_to: datetime | None = Query(default=None),
    admin_only: bool = Query(default=False),
    discipline: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[AuditLogRead]:
    if not access.is_admin:
        # Не админ — доступен только урезанный журнал СВОЕЙ дисциплины (DEP+/CU),
        # без права смотреть что-либо ещё (общие фильтры action/admin_only
        # игнорируются, чтобы нельзя было обойти ограничение через них)
        if discipline is None or discipline not in DISCIPLINE_CATEGORIES or not access.is_discipline_deputy(discipline):
            raise ForbiddenError(
                "Полный журнал доступен только администратору — DEP+/куратору доступна только своя дисциплина"
            )
        entries = await audit_log_crud.list_recent(
            db, limit=limit, date_from=date_from, date_to=date_to, discipline=discipline, actions=_DISCIPLINE_ACTIONS
        )
        return [AuditLogRead.model_validate(e) for e in entries]

    entries = await audit_log_crud.list_recent(
        db,
        limit=limit,
        action=action,
        date_from=date_from,
        date_to=date_to,
        admin_only=admin_only,
        discipline=discipline,
    )
    return [AuditLogRead.model_validate(e) for e in entries]
