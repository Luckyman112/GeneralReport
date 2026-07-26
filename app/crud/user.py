from datetime import datetime, timedelta, timezone

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


async def get_by_ids(db: AsyncSession, user_ids: list[int]) -> list[User]:
    if not user_ids:
        return []
    result = await db.execute(select(User).where(User.id.in_(user_ids)))
    return list(result.scalars().all())


async def list_admins_and_high_command(db: AsyncSession) -> list[User]:
    """Все, кто сейчас является администратором или высшим командованием: по
    Discord-роли (admin_role_id/high_command_role_id), по явному списку людей
    (admin_user_discord_ids) или по входу по паролю. Только среди тех, кто хотя бы
    раз заходил на сайт (есть запись users) — используется для рассылки уведомлений,
    не для проверки прав доступа (см. app/api/deps.py::get_access_context)."""
    from app.core.constants import PASSWORD_LOGIN_DISCORD_ID
    from app.crud import app_settings as app_settings_crud

    app_config = await app_settings_crud.get(db)
    result = await db.execute(select(User))
    users = list(result.scalars().all())
    admin_discord_ids = set(app_config.admin_user_discord_ids or [])
    return [
        u
        for u in users
        if u.discord_id == PASSWORD_LOGIN_DISCORD_ID
        or u.discord_id in admin_discord_ids
        or (app_config.admin_role_id and app_config.admin_role_id in u.roles)
        or (app_config.high_command_role_id and app_config.high_command_role_id in u.roles)
    ]


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


async def set_rank_assigned_at(db: AsyncSession, user: User, *, days_in_rank: int) -> User:
    """Админ-панель: перематывает "дату получения текущего звания" назад на
    days_in_rank дней от текущего момента — это меняет days_in_rank, который видит
    и сверяет с требованием по выслуге /me/promotion-status."""
    user.rank_assigned_at = datetime.now(timezone.utc) - timedelta(days=days_in_rank)
    await db.commit()
    await db.refresh(user, attribute_names=["rank"])
    return user
