"""Заявки на отпуск — конкретные даты "с — по" + причина. Видимость как у нарушений/
выговоров: администратор/высшее командование видят все, командир/заместитель — по
своим формированиям, обычный боец — только свои."""
import logging

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AccessContext, get_access_context
from app.core.events import event_bus
from app.crud import audit_log as audit_log_crud
from app.crud import leave_request as leave_request_crud
from app.database import get_db
from app.exceptions import ForbiddenError, NotFoundError
from app.schemas.leave_request import LeaveRequestCreate, LeaveRequestRead

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/leave-requests", tags=["leave-requests"])


@router.post("", response_model=LeaveRequestRead)
async def create_leave_request(
    payload: LeaveRequestCreate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> LeaveRequestRead:
    if not (access.is_admin or access.is_high_command or payload.regiment_id in access.own_regiment_ids):
        raise ForbiddenError("Вы не состоите в этом формировании")

    request = await leave_request_crud.create(
        db,
        user_id=access.user.id,
        regiment_id=payload.regiment_id,
        start_date=payload.start_date,
        end_date=payload.end_date,
        reason=payload.reason,
    )
    logger.info("%s подал заявку на отпуск %s - %s", access.user.username, payload.start_date, payload.end_date)
    event_bus.publish("leave_requests")
    return LeaveRequestRead.model_validate(request)


@router.get("", response_model=list[LeaveRequestRead])
async def list_leave_requests(
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[LeaveRequestRead]:
    if access.is_admin or access.is_high_command:
        requests = await leave_request_crud.list_all(db)
    elif access.commander_regiment_ids:
        requests = await leave_request_crud.list_by_regiments(db, regiment_ids=access.commander_regiment_ids)
    else:
        requests = await leave_request_crud.list_by_user(db, user_id=access.user.id)
    return [LeaveRequestRead.model_validate(r) for r in requests]


@router.post("/{request_id}/approve", response_model=LeaveRequestRead)
async def approve_leave_request(
    request_id: int,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> LeaveRequestRead:
    request = await leave_request_crud.get_by_id(db, request_id)
    if request is None:
        raise NotFoundError("Заявка не найдена")
    if not access.is_commander_of(request.regiment_id):
        raise ForbiddenError("Одобрить заявку может только командир формирования")

    updated = await leave_request_crud.decide(db, request, approve=True, decided_by=access.user.id)
    logger.info("%s одобрил заявку на отпуск %s", access.user.username, request_id)
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="leave_approve",
        details=f"Одобрил заявку на отпуск #{request_id} ({request.start_date} — {request.end_date})",
        target_user_id=request.user_id,
    )
    event_bus.publish("leave_requests")
    return LeaveRequestRead.model_validate(updated)


@router.post("/{request_id}/reject", response_model=LeaveRequestRead)
async def reject_leave_request(
    request_id: int,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> LeaveRequestRead:
    request = await leave_request_crud.get_by_id(db, request_id)
    if request is None:
        raise NotFoundError("Заявка не найдена")
    if not access.is_commander_of(request.regiment_id):
        raise ForbiddenError("Отклонить заявку может только командир формирования")

    updated = await leave_request_crud.decide(db, request, approve=False, decided_by=access.user.id)
    logger.info("%s отклонил заявку на отпуск %s", access.user.username, request_id)
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="leave_reject",
        details=f"Отклонил заявку на отпуск #{request_id} ({request.start_date} — {request.end_date})",
        target_user_id=request.user_id,
    )
    event_bus.publish("leave_requests")
    return LeaveRequestRead.model_validate(updated)
