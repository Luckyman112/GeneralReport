from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.transfer_request import TransferRequest
from app.models.user import User

_LOAD_OPTIONS = [
    selectinload(TransferRequest.user).selectinload(User.rank),
    selectinload(TransferRequest.from_regiment),
    selectinload(TransferRequest.to_regiment),
    selectinload(TransferRequest.target_rank),
    selectinload(TransferRequest.approved_by_source),
    selectinload(TransferRequest.approved_by_target),
    selectinload(TransferRequest.rejected_by),
]

# Заявка ещё "в игре" — либо ждёт одобрений, либо уже одобрена и боец заморожен
# в ожидании смены роли в Discord (см. app/api/auth.py::login_via_discord)
ACTIVE_STATUSES = ("pending", "approved")


async def create(db: AsyncSession, *, user_id: int, from_regiment_id: int, to_regiment_id: int, reason: str) -> TransferRequest:
    request = TransferRequest(
        user_id=user_id, from_regiment_id=from_regiment_id, to_regiment_id=to_regiment_id, reason=reason
    )
    db.add(request)
    await db.commit()
    return await get_by_id(db, request.id)


async def get_by_id(db: AsyncSession, request_id: int) -> TransferRequest | None:
    return await db.get(TransferRequest, request_id, options=_LOAD_OPTIONS, populate_existing=True)


async def get_active_for_user(db: AsyncSession, *, user_id: int) -> TransferRequest | None:
    result = await db.execute(
        select(TransferRequest)
        .where(TransferRequest.user_id == user_id, TransferRequest.status.in_(ACTIVE_STATUSES))
        .options(*_LOAD_OPTIONS)
        .order_by(TransferRequest.created_at.desc())
    )
    return result.scalars().first()


async def list_all_pending(db: AsyncSession) -> list[TransferRequest]:
    result = await db.execute(
        select(TransferRequest)
        .where(TransferRequest.status == "pending")
        .options(*_LOAD_OPTIONS)
        .order_by(TransferRequest.created_at.desc())
    )
    return list(result.scalars().all())


async def approve_source(db: AsyncSession, request: TransferRequest, *, approved_by: int) -> TransferRequest:
    request.approved_by_source_id = approved_by
    request.approved_by_source_at = datetime.now(timezone.utc)
    if request.approved_by_target_id is not None:
        request.status = "approved"
    await db.commit()
    return await get_by_id(db, request.id)


async def approve_target(
    db: AsyncSession, request: TransferRequest, *, approved_by: int, target_rank_id: int
) -> TransferRequest:
    request.approved_by_target_id = approved_by
    request.approved_by_target_at = datetime.now(timezone.utc)
    request.target_rank_id = target_rank_id
    if request.approved_by_source_id is not None:
        request.status = "approved"
    await db.commit()
    return await get_by_id(db, request.id)


async def reject(db: AsyncSession, request: TransferRequest, *, rejected_by: int, reason: str | None) -> TransferRequest:
    request.status = "rejected"
    request.rejected_by_id = rejected_by
    request.rejected_at = datetime.now(timezone.utc)
    request.rejection_reason = reason
    await db.commit()
    return await get_by_id(db, request.id)


async def complete(db: AsyncSession, request: TransferRequest) -> TransferRequest:
    request.status = "completed"
    await db.commit()
    return await get_by_id(db, request.id)
