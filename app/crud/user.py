from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

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
