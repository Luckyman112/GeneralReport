from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import AppError
from app.models.squad import DEFAULT_SQUAD_TIER_LABELS, Squad, SquadMembership


async def list_by_regiment(db: AsyncSession, *, regiment_id: int) -> list[Squad]:
    result = await db.execute(select(Squad).where(Squad.regiment_id == regiment_id).order_by(Squad.name))
    return list(result.scalars().all())


async def get_by_id(db: AsyncSession, squad_id: int) -> Squad | None:
    return await db.get(Squad, squad_id)


async def create(db: AsyncSession, *, regiment_id: int, name: str) -> Squad:
    squad = Squad(regiment_id=regiment_id, name=name, tier_labels=list(DEFAULT_SQUAD_TIER_LABELS))
    db.add(squad)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise AppError("Отряд с таким названием уже есть в этом формировании")
    await db.refresh(squad)
    return squad


async def update_tier_labels(db: AsyncSession, squad: Squad, *, tier_labels: list[str]) -> Squad:
    squad.tier_labels = tier_labels
    await db.commit()
    await db.refresh(squad)
    return squad


async def delete(db: AsyncSession, squad: Squad) -> None:
    await db.execute(SquadMembership.__table__.delete().where(SquadMembership.squad_id == squad.id))
    await db.delete(squad)
    await db.commit()


async def list_members(db: AsyncSession, *, squad_id: int) -> list[SquadMembership]:
    result = await db.execute(select(SquadMembership).where(SquadMembership.squad_id == squad_id))
    return list(result.scalars().all())


async def list_memberships_for_regiment(db: AsyncSession, *, regiment_id: int) -> list[SquadMembership]:
    """Все членства отрядов формирования разом, с именем отряда — для показа
    ярлыков в общем составе (см. app/api/regiments.py::get_members)."""
    result = await db.execute(
        select(SquadMembership, Squad)
        .join(Squad, SquadMembership.squad_id == Squad.id)
        .where(Squad.regiment_id == regiment_id)
    )
    return list(result.all())


async def add_member(db: AsyncSession, *, squad_id: int, discord_id: str, username: str, tier: int) -> SquadMembership:
    membership = SquadMembership(squad_id=squad_id, discord_id=discord_id, username=username, tier=tier)
    db.add(membership)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise AppError("Этот человек уже состоит в этом отряде — сначала снимите старое назначение")
    await db.refresh(membership)
    return membership


async def update_member_tier(db: AsyncSession, membership: SquadMembership, *, tier: int) -> SquadMembership:
    membership.tier = tier
    await db.commit()
    await db.refresh(membership)
    return membership


async def get_membership(db: AsyncSession, *, squad_id: int, discord_id: str) -> SquadMembership | None:
    result = await db.execute(
        select(SquadMembership).where(SquadMembership.squad_id == squad_id, SquadMembership.discord_id == discord_id)
    )
    return result.scalar_one_or_none()


async def remove_member(db: AsyncSession, membership: SquadMembership) -> None:
    await db.delete(membership)
    await db.commit()
