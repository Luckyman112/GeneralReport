from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.regiment import Regiment


async def get_all(db: AsyncSession) -> list[Regiment]:
    result = await db.execute(select(Regiment))
    return list(result.scalars().all())


async def get_by_id(db: AsyncSession, regiment_id: int) -> Regiment | None:
    return await db.get(Regiment, regiment_id)


async def create(db: AsyncSession, *, name: str, discord_role_id: str, color: str | None = None) -> Regiment:
    regiment = Regiment(name=name, discord_role_id=discord_role_id, color=color)
    db.add(regiment)
    await db.commit()
    await db.refresh(regiment)
    return regiment


async def update(db: AsyncSession, regiment: Regiment, **changes) -> Regiment:
    """changes — только реально переданные клиентом поля (exclude_unset в
    эндпоинте), поэтому color: None здесь означает явную очистку, а не "не трогать"."""
    for key, value in changes.items():
        setattr(regiment, key, value)
    await db.commit()
    await db.refresh(regiment)
    return regiment
