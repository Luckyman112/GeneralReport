from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.rank import Rank, RankTier


async def get_all_tiers(db: AsyncSession) -> list[RankTier]:
    result = await db.execute(select(RankTier).options(selectinload(RankTier.ranks)).order_by(RankTier.order))
    return list(result.scalars().all())


async def get_by_id(db: AsyncSession, rank_id: int) -> Rank | None:
    return await db.get(Rank, rank_id)


async def get_tier_by_id(db: AsyncSession, tier_id: int) -> RankTier | None:
    return await db.get(RankTier, tier_id, options=[selectinload(RankTier.ranks)], populate_existing=True)


async def update_tier_tenure(db: AsyncSession, tier: RankTier, *, tenure_days_required: int | None) -> RankTier:
    tier.tenure_days_required = tenure_days_required
    await db.commit()
    return await get_tier_by_id(db, tier.id)


async def update_rank_tenure(db: AsyncSession, rank: Rank, *, tenure_days_required: int | None) -> Rank:
    rank.tenure_days_required = tenure_days_required
    await db.commit()
    await db.refresh(rank)
    return rank


def effective_tenure_days(rank: Rank) -> int | None:
    """Своё требование по звания важнее общего требования состава — если задано,
    перекрывает tier.tenure_days_required именно для этого звания (rank.tier
    должен быть заранее подгружен, например через get_all_ranks_ordered)."""
    return rank.tenure_days_required if rank.tenure_days_required is not None else rank.tier.tenure_days_required


async def get_all_ranks_ordered(db: AsyncSession) -> list[Rank]:
    """Все звания одним плоским списком, от младших к старшим (по составу, потом по
    званию внутри состава) — с подгруженным tier, чтобы можно было безопасно
    прочитать tenure_days_required без отдельного запроса."""
    result = await db.execute(
        select(Rank).join(RankTier).options(selectinload(Rank.tier)).order_by(RankTier.order, Rank.order)
    )
    return list(result.scalars().all())


async def get_next_rank(db: AsyncSession, current_rank_id: int) -> Rank | None:
    ranks = await get_all_ranks_ordered(db)
    for index, rank in enumerate(ranks):
        if rank.id == current_rank_id and index + 1 < len(ranks):
            return ranks[index + 1]
    return None
