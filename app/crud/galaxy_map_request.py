from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.exceptions import AppError
from app.models.galaxy_map_request import GalaxyMapRequest
from app.models.user import User

# .selectinload(User.rank) обязателен — UserBrief.rank читается синхронно при
# сериализации ответа; без eager load это ленивая relationship, а обращение к
# ней вне await в асинхронном SQLAlchemy падает MissingGreenlet (500) — тот же
# паттерн, что уже учтён во всех остальных crud-модулях с UserBrief-полем
# (см. документацию в CLAUDE.md).
_LOAD_OPTIONS = [
    selectinload(GalaxyMapRequest.submitted_by).selectinload(User.rank),
    selectinload(GalaxyMapRequest.decided_by).selectinload(User.rank),
]


async def get_by_id(db: AsyncSession, request_id) -> GalaxyMapRequest | None:
    return await db.get(GalaxyMapRequest, request_id, options=_LOAD_OPTIONS, populate_existing=True)


async def list_pending(db: AsyncSession) -> list[GalaxyMapRequest]:
    result = await db.execute(
        select(GalaxyMapRequest)
        .options(*_LOAD_OPTIONS)
        .where(GalaxyMapRequest.status == "pending")
        .order_by(GalaxyMapRequest.created_at)
    )
    return list(result.scalars().all())


async def create(db: AsyncSession, *, data: dict, note: str | None, submitted_by_user_id: int) -> GalaxyMapRequest:
    row = GalaxyMapRequest(data=data, note=note, submitted_by_user_id=submitted_by_user_id)
    db.add(row)
    await db.commit()
    return await get_by_id(db, row.id)


async def decide(
    db: AsyncSession, request: GalaxyMapRequest, *, approve: bool, decided_by_user_id: int, rejection_reason: str | None
) -> GalaxyMapRequest:
    if request.status != "pending":
        raise AppError("Заявка уже рассмотрена")
    request.status = "approved" if approve else "rejected"
    request.decided_by_user_id = decided_by_user_id
    request.decided_at = datetime.now(timezone.utc)
    request.rejection_reason = None if approve else rejection_reason
    await db.commit()
    return await get_by_id(db, request.id)
