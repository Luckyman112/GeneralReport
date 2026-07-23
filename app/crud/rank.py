from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.rank import Rank, RankTier


async def get_all_tiers(db: AsyncSession) -> list[RankTier]:
    result = await db.execute(select(RankTier).options(selectinload(RankTier.ranks)).order_by(RankTier.order))
    return list(result.scalars().all())


async def get_by_id(db: AsyncSession, rank_id: int) -> Rank | None:
    return await db.get(Rank, rank_id)
