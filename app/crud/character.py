from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import selectinload

from app.exceptions import AppError
from app.models.character import Character

_LOAD_OPTIONS = [selectinload(Character.rank), selectinload(Character.regiment)]
_LOAD_OPTIONS_WITH_USER = _LOAD_OPTIONS + [selectinload(Character.user)]


async def list_for_user(db: AsyncSession, *, user_id: int) -> list[Character]:
    result = await db.execute(
        select(Character).where(Character.user_id == user_id).options(*_LOAD_OPTIONS).order_by(Character.created_at)
    )
    return list(result.scalars().all())


async def get_by_id(db: AsyncSession, character_id: int) -> Character | None:
    return await db.get(Character, character_id, options=_LOAD_OPTIONS, populate_existing=True)


async def list_jedi(db: AsyncSession) -> list[Character]:
    """Все персонажи-джедаи (см. app/api/regiments.py::get_mentor_candidates —
    джедаи являются кандидатами в наставники независимо от
    mentor_source_regiment_ids)."""
    result = await db.execute(
        select(Character).where(Character.is_jedi.is_(True)).options(*_LOAD_OPTIONS_WITH_USER)
    )
    return list(result.scalars().all())


async def get_by_regiment_id(db: AsyncSession, *, regiment_id: int) -> list[Character]:
    result = await db.execute(
        select(Character).where(Character.regiment_id == regiment_id).options(*_LOAD_OPTIONS_WITH_USER)
    )
    return list(result.scalars().all())


async def get_by_user_and_regiment(db: AsyncSession, *, user_id: int, regiment_id: int) -> Character | None:
    result = await db.execute(
        select(Character)
        .where(Character.user_id == user_id, Character.regiment_id == regiment_id)
        .options(*_LOAD_OPTIONS)
    )
    return result.scalars().first()


async def create(
    db: AsyncSession,
    *,
    user_id: int,
    regiment_id: int,
    created_by_user_id: int,
    service_id: str | None = None,
    callsign: str | None = None,
    rank_id: int | None = None,
    steam_id: str | None = None,
    is_jedi: bool = False,
) -> Character:
    character = Character(
        user_id=user_id,
        regiment_id=regiment_id,
        created_by_user_id=created_by_user_id,
        service_id=service_id,
        callsign=callsign,
        rank_id=rank_id,
        rank_assigned_at=datetime.now(timezone.utc) if rank_id is not None else None,
        steam_id=steam_id,
        is_jedi=is_jedi,
    )
    db.add(character)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise AppError("У этого пользователя уже есть персонаж в этом формировании")
    return await get_by_id(db, character.id)


async def update(db: AsyncSession, character: Character, **changes) -> Character:
    """changes — только реально переданные клиентом поля (exclude_unset в
    эндпоинте), как и остальные частичные обновления в проекте."""
    # Не тронуто до этого фикса: days_in_rank для персонажей всегда был пуст в
    # составе, потому что rank_assigned_at никогда не выставлялся (баг-репорт)
    if "rank_id" in changes and changes["rank_id"] != character.rank_id:
        character.rank_assigned_at = datetime.now(timezone.utc) if changes["rank_id"] is not None else None
    for key, value in changes.items():
        setattr(character, key, value)
    await db.commit()
    return await get_by_id(db, character.id)


async def delete(db: AsyncSession, character: Character) -> None:
    await db.delete(character)
    await db.commit()
