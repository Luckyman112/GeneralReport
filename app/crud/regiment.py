from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.regiment import Regiment


async def get_all(db: AsyncSession) -> list[Regiment]:
    result = await db.execute(select(Regiment))
    return list(result.scalars().all())


async def get_by_id(db: AsyncSession, regiment_id: int) -> Regiment | None:
    return await db.get(Regiment, regiment_id)


async def create(db: AsyncSession, *, name: str, discord_role_id: str) -> Regiment:
    regiment = Regiment(name=name, discord_role_id=discord_role_id)
    db.add(regiment)
    await db.commit()
    await db.refresh(regiment)
    return regiment


async def update(
    db: AsyncSession,
    regiment: Regiment,
    *,
    name: str | None = None,
    discord_role_id: str | None = None,
) -> Regiment:
    if name is not None:
        regiment.name = name
    if discord_role_id is not None:
        regiment.discord_role_id = discord_role_id

    await db.commit()
    await db.refresh(regiment)
    return regiment
