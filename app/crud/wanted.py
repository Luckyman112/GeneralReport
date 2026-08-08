from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.user import User
from app.models.wanted import WantedEntry

_LOAD_OPTIONS = [
    selectinload(WantedEntry.rank),
    selectinload(WantedEntry.author).selectinload(User.rank),
    selectinload(WantedEntry.resolved_by_user).selectinload(User.rank),
]


async def list_all(db: AsyncSession) -> list[WantedEntry]:
    """Активные сначала (новые вперёд), затем архив (снятые с розыска, тоже
    новые вперёд) — фронт сам решает, показывать архив свёрнутым или нет."""
    query = (
        select(WantedEntry)
        .options(*_LOAD_OPTIONS)
        .order_by(WantedEntry.status.asc(), WantedEntry.created_at.desc())
    )
    result = await db.execute(query)
    return list(result.scalars().all())


async def get_by_id(db: AsyncSession, entry_id: int) -> WantedEntry | None:
    return await db.get(WantedEntry, entry_id, options=_LOAD_OPTIONS, populate_existing=True)


async def create(
    db: AsyncSession,
    *,
    nickname: str,
    service_id: str | None,
    rank_id: int | None,
    regiment_id: int | None,
    reason: str,
    created_by: int,
) -> WantedEntry:
    entry = WantedEntry(
        nickname=nickname,
        service_id=service_id,
        rank_id=rank_id,
        regiment_id=regiment_id,
        reason=reason,
        created_by=created_by,
    )
    db.add(entry)
    await db.commit()
    return await get_by_id(db, entry.id)


async def resolve(db: AsyncSession, entry: WantedEntry, *, resolution: str, resolved_by: int) -> WantedEntry:
    entry.status = "resolved"
    entry.resolution = resolution
    entry.resolved_by = resolved_by
    entry.resolved_at = datetime.now(timezone.utc)
    await db.commit()
    return await get_by_id(db, entry.id)


async def delete(db: AsyncSession, entry: WantedEntry) -> None:
    await db.delete(entry)
    await db.commit()
