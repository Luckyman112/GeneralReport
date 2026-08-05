"""Заявки на перевод между формированиями — боец указывает цель и причину,
одобряют заместитель+ формирования-источника И формирования-цели раздельно.
После двойного одобрения боец замораживается, пока в Discord у него не
появится роль нового формирования (см. app/api/auth.py::login_via_discord)."""
import logging

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AccessContext, get_access_context
from app.core.events import event_bus
from app.crud import audit_log as audit_log_crud
from app.crud import notification as notification_crud
from app.crud import rank as rank_crud
from app.crud import regiment as regiment_crud
from app.crud import regiment_commander as regiment_commander_crud
from app.crud import transfer_request as transfer_request_crud
from app.crud import user as user_crud
from app.database import get_db
from app.exceptions import AppError, ForbiddenError, NotFoundError
from app.schemas.transfer_request import (
    TransferApproveTargetRequest,
    TransferRejectRequest,
    TransferRequestCreate,
    TransferRequestRead,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/transfer-requests", tags=["transfer-requests"])


@router.post("", response_model=TransferRequestRead, status_code=201)
async def create_transfer_request(
    payload: TransferRequestCreate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> TransferRequestRead:
    if not access.soldier_regiment_ids:
        raise ForbiddenError("Вы не состоите ни в одном формировании")
    if len(access.soldier_regiment_ids) > 1:
        raise AppError("У вас несколько формирований одновременно — сначала обратитесь к администрации")
    from_regiment_id = next(iter(access.soldier_regiment_ids))
    if payload.to_regiment_id == from_regiment_id:
        raise AppError("Формирование-цель совпадает с текущим формированием")
    to_regiment = await regiment_crud.get_by_id(db, payload.to_regiment_id)
    if to_regiment is None:
        raise NotFoundError("Формирование-цель не найдено")

    existing = await transfer_request_crud.get_active_for_user(db, user_id=access.user.id)
    if existing is not None:
        raise AppError("У вас уже есть активная заявка на перевод")

    request = await transfer_request_crud.create(
        db,
        user_id=access.user.id,
        from_regiment_id=from_regiment_id,
        to_regiment_id=payload.to_regiment_id,
        reason=payload.reason.strip(),
    )
    logger.info(
        "%s подал заявку на перевод из формирования %s в %s", access.user.username, from_regiment_id, payload.to_regiment_id
    )

    notified: set[int] = set()
    for regiment_id in (from_regiment_id, payload.to_regiment_id):
        for commander in await regiment_commander_crud.get_by_regiment(db, regiment_id):
            target = await user_crud.get_by_discord_id(db, commander.discord_id)
            if target is None or target.id in notified:
                continue
            notified.add(target.id)
            await notification_crud.create_personal_notification(
                db,
                target_user_id=target.id,
                title="Новая заявка на перевод",
                body=f"{access.user.username}: {request.reason}",
                created_by=access.user.id,
            )

    event_bus.publish("transfer_requests")
    return TransferRequestRead.model_validate(request)


@router.get("", response_model=list[TransferRequestRead])
async def list_transfer_requests(
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[TransferRequestRead]:
    if access.is_admin or access.is_high_command:
        requests = await transfer_request_crud.list_all_pending(db)
    else:
        requests = [
            r
            for r in await transfer_request_crud.list_all_pending(db)
            if access.is_commander_of(r.from_regiment_id) or access.is_commander_of(r.to_regiment_id)
        ]
    return [TransferRequestRead.model_validate(r) for r in requests]


async def _get_request_or_404(db: AsyncSession, request_id: int):
    request = await transfer_request_crud.get_by_id(db, request_id)
    if request is None:
        raise NotFoundError("Заявка не найдена")
    return request


@router.post("/{request_id}/approve-source", response_model=TransferRequestRead)
async def approve_transfer_source(
    request_id: int,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> TransferRequestRead:
    request = await _get_request_or_404(db, request_id)
    if not access.is_commander_of(request.from_regiment_id):
        raise ForbiddenError("Одобрить может только заместитель+ формирования, откуда уходит боец")
    if request.status != "pending":
        raise AppError("Заявка уже решена")

    updated = await transfer_request_crud.approve_source(db, request, approved_by=access.user.id)
    if updated.status == "approved":
        await notification_crud.create_personal_notification(
            db,
            target_user_id=updated.user_id,
            title="Перевод одобрен",
            body="Ваш перевод одобрен обеими сторонами — дождитесь смены роли в Discord.",
            created_by=access.user.id,
        )
    logger.info("%s одобрил перевод %s со стороны формирования-источника", access.user.username, request_id)
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="transfer_approve_source",
        details=f"Одобрил перевод #{request_id} со стороны формирования-источника",
        target_user_id=updated.user_id,
    )
    event_bus.publish("transfer_requests")
    return TransferRequestRead.model_validate(updated)


@router.post("/{request_id}/approve-target", response_model=TransferRequestRead)
async def approve_transfer_target(
    request_id: int,
    payload: TransferApproveTargetRequest,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> TransferRequestRead:
    request = await _get_request_or_404(db, request_id)
    if not access.is_commander_of(request.to_regiment_id):
        raise ForbiddenError("Одобрить может только заместитель+ формирования-получателя")
    if request.status != "pending":
        raise AppError("Заявка уже решена")

    rank = await rank_crud.get_by_id(db, payload.target_rank_id)
    if rank is None:
        raise NotFoundError("Звание не найдено")
    to_regiment = await regiment_crud.get_by_id(db, request.to_regiment_id)
    if to_regiment.is_jedi_order and not rank.tier.is_jedi:
        raise AppError("Этому формированию можно назначить только джедайское звание")
    if not to_regiment.is_jedi_order and rank.tier.is_jedi:
        raise AppError("Обычному формированию нельзя назначить джедайское звание")

    updated = await transfer_request_crud.approve_target(
        db, request, approved_by=access.user.id, target_rank_id=payload.target_rank_id
    )
    if updated.status == "approved":
        await notification_crud.create_personal_notification(
            db,
            target_user_id=updated.user_id,
            title="Перевод одобрен",
            body="Ваш перевод одобрен обеими сторонами — дождитесь смены роли в Discord.",
            created_by=access.user.id,
        )
    logger.info("%s одобрил перевод %s со стороны формирования-получателя (звание: %s)", access.user.username, request_id, rank.code)
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="transfer_approve_target",
        details=f"Одобрил перевод #{request_id} со стороны формирования-получателя, звание {rank.code}",
        target_user_id=updated.user_id,
    )
    event_bus.publish("transfer_requests")
    return TransferRequestRead.model_validate(updated)


@router.post("/{request_id}/reject", response_model=TransferRequestRead)
async def reject_transfer_request(
    request_id: int,
    payload: TransferRejectRequest,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> TransferRequestRead:
    request = await _get_request_or_404(db, request_id)
    if not (access.is_commander_of(request.from_regiment_id) or access.is_commander_of(request.to_regiment_id)):
        raise ForbiddenError("Отклонить может только заместитель+ одной из двух сторон")
    if request.status != "pending":
        raise AppError("Заявка уже решена")

    updated = await transfer_request_crud.reject(db, request, rejected_by=access.user.id, reason=payload.reason)
    await notification_crud.create_personal_notification(
        db,
        target_user_id=updated.user_id,
        title="Перевод отклонён",
        body=payload.reason or "Заявка на перевод отклонена.",
        created_by=access.user.id,
    )
    logger.info("%s отклонил заявку на перевод %s", access.user.username, request_id)
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="transfer_reject",
        details=f"Отклонил заявку на перевод #{request_id}" + (f": {payload.reason}" if payload.reason else ""),
        target_user_id=updated.user_id,
    )
    event_bus.publish("transfer_requests")
    return TransferRequestRead.model_validate(updated)
