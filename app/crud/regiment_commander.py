from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.regiment_commander import RegimentCommander


async def get_by_regiment(db: AsyncSession, regiment_id: int) -> list[RegimentCommander]:
    result = await db.execute(
        select(RegimentCommander).where(RegimentCommander.regiment_id == regiment_id)
    )
    return list(result.scalars().all())


async def get_all(db: AsyncSession) -> list[RegimentCommander]:
    result = await db.execute(select(RegimentCommander))
    return list(result.scalars().all())


async def add(
    db: AsyncSession, *, regiment_id: int, discord_id: str, username: str, role_type: str = "commander"
) -> RegimentCommander:
    commander = RegimentCommander(
        regiment_id=regiment_id, discord_id=discord_id, username=username, role_type=role_type
    )
    db.add(commander)
    await db.commit()
    await db.refresh(commander)
    return commander


async def remove(db: AsyncSession, *, regiment_id: int, discord_id: str) -> bool:
    result = await db.execute(
        select(RegimentCommander).where(
            RegimentCommander.regiment_id == regiment_id, RegimentCommander.discord_id == discord_id
        )
    )
    commander = result.scalar_one_or_none()
    if commander is None:
        return False
    await db.delete(commander)
    await db.commit()
    return True
