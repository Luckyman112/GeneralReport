from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.points_adjustment import PointsAdjustment


async def create(
    db: AsyncSession, *, user_id: int, regiment_id: int, points: int, reason: str, created_by: int
) -> PointsAdjustment:
    adjustment = PointsAdjustment(
        user_id=user_id, regiment_id=regiment_id, points=points, reason=reason, created_by=created_by
    )
    db.add(adjustment)
    await db.commit()
    await db.refresh(adjustment, attribute_names=["creator"])
    return adjustment


async def list_for_user(db: AsyncSession, *, user_id: int) -> list[PointsAdjustment]:
    result = await db.execute(
        select(PointsAdjustment)
        .where(PointsAdjustment.user_id == user_id)
        .options(selectinload(PointsAdjustment.creator))
        .order_by(PointsAdjustment.created_at.desc())
    )
    return list(result.scalars().all())


async def sum_for_user(db: AsyncSession, *, user_id: int, since=None) -> int:
    query = select(func.coalesce(func.sum(PointsAdjustment.points), 0)).where(PointsAdjustment.user_id == user_id)
    if since is not None:
        query = query.where(PointsAdjustment.created_at >= since)
    result = await db.execute(query)
    return int(result.scalar_one())
