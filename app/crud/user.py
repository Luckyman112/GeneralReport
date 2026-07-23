from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.user import User


async def get_by_discord_id(db: AsyncSession, discord_id: str) -> User | None:
    result = await db.execute(select(User).where(User.discord_id == discord_id))
    return result.scalar_one_or_none()


async def upsert_user(
    db: AsyncSession,
    *,
    discord_id: str,
    username: str,
    avatar_url: str | None,
    roles: list[str],
) -> User:
    """Создаёт пользователя при первом входе или обновляет его профиль/роли при повторном."""
    user = await get_by_discord_id(db, discord_id)

    if user is None:
        user = User(discord_id=discord_id, username=username, avatar_url=avatar_url, roles=roles)
        db.add(user)
    else:
        user.username = username
        user.avatar_url = avatar_url
        user.roles = roles

    await db.commit()
    await db.refresh(user)
    return user


async def get_by_id(db: AsyncSession, user_id: int) -> User | None:
    return await db.get(User, user_id)


async def get_by_discord_ids(db: AsyncSession, discord_ids: list[str]) -> list[User]:
    if not discord_ids:
        return []
    result = await db.execute(
        select(User).where(User.discord_id.in_(discord_ids)).options(selectinload(User.rank))
    )
    return list(result.scalars().all())


async def update_profile(
    db: AsyncSession, *, discord_id: str, fallback_username: str, changes: dict
) -> User:
    """Обновляет ИДН/позывной/звание участника. changes — только реально переданные
    клиентом поля (см. exclude_unset в эндпоинте). Смена rank_id сбрасывает отсчёт
    выслуги (rank_assigned_at); правки остальных полей — нет. Как и с веб-ником,
    если участник ещё не логинился на сайт — создаёт для него запись заранее."""
    user = await get_by_discord_id(db, discord_id)
    if user is None:
        user = User(discord_id=discord_id, username=fallback_username, avatar_url=None, roles=[])
        db.add(user)

    if "rank_id" in changes and changes["rank_id"] != user.rank_id:
        user.rank_assigned_at = datetime.now(timezone.utc) if changes["rank_id"] is not None else None

    for key, value in changes.items():
        setattr(user, key, value)

    await db.commit()
    await db.refresh(user, attribute_names=["rank"])
    return user
