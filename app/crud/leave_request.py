from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.leave_request import LeaveRequest
from app.models.user import User

_LOAD_OPTIONS = [
    selectinload(LeaveRequest.user).selectinload(User.rank),
    selectinload(LeaveRequest.decided_by_user).selectinload(User.rank),
]


async def create(
    db: AsyncSession, *, user_id: int, regiment_id: int, start_date, end_date, reason: str
) -> LeaveRequest:
    request = LeaveRequest(
        user_id=user_id, regiment_id=regiment_id, start_date=start_date, end_date=end_date, reason=reason
    )
    db.add(request)
    await db.commit()
    return await get_by_id(db, request.id)


async def get_by_id(db: AsyncSession, request_id: int) -> LeaveRequest | None:
    return await db.get(LeaveRequest, request_id, options=_LOAD_OPTIONS, populate_existing=True)


async def list_all(db: AsyncSession) -> list[LeaveRequest]:
    result = await db.execute(select(LeaveRequest).options(*_LOAD_OPTIONS).order_by(LeaveRequest.created_at.desc()))
    return list(result.scalars().all())


async def list_by_regiments(db: AsyncSession, *, regiment_ids: set[int]) -> list[LeaveRequest]:
    result = await db.execute(
        select(LeaveRequest)
        .where(LeaveRequest.regiment_id.in_(regiment_ids))
        .options(*_LOAD_OPTIONS)
        .order_by(LeaveRequest.created_at.desc())
    )
    return list(result.scalars().all())


async def list_by_user(db: AsyncSession, *, user_id: int) -> list[LeaveRequest]:
    result = await db.execute(
        select(LeaveRequest)
        .where(LeaveRequest.user_id == user_id)
        .options(*_LOAD_OPTIONS)
        .order_by(LeaveRequest.created_at.desc())
    )
    return list(result.scalars().all())


async def decide(db: AsyncSession, request: LeaveRequest, *, approve: bool, decided_by: int) -> LeaveRequest:
    request.status = "approved" if approve else "rejected"
    request.decided_by = decided_by
    request.decided_at = datetime.now(timezone.utc)
    await db.commit()
    return await get_by_id(db, request.id)
