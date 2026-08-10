from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.user import User


def format_full_name(user: User) -> str:
    """Полное имя для отображения ("ИДН Звание Позывной"), как formatFullName на
    фронте — используется там, где формируется текст на бэкенде (например, метки
    в статистике)."""
    if user.service_id and user.rank and user.callsign:
        return f"{user.service_id} {user.rank.code} {user.callsign}"
    return user.nickname_override or user.username


async def get_by_discord_id(db: AsyncSession, discord_id: str) -> User | None:
    result = await db.execute(select(User).where(User.discord_id == discord_id))
    return result.scalar_one_or_none()


async def get_by_steam_id(db: AsyncSession, steam_id: str) -> User | None:
    result = await db.execute(select(User).where(User.steam_id == steam_id))
    return result.scalars().first()


async def set_verified_steam_id(db: AsyncSession, *, user_id: int, steam_id: str) -> User | None:
    """Записывает Steam ID, полученный через реальный вход (OpenID) — в отличие
    от update_profile, тут не нужен весь набор полей регистрации, только Steam."""
    user = await get_by_id(db, user_id)
    if user is None:
        return None
    user.steam_id = steam_id
    user.steam_verified = True
    await db.commit()
    await db.refresh(user)
    return user


async def find_by_service_id_or_steam_id(
    db: AsyncSession, *, service_id: str, steam_id: str, exclude_discord_id: str
) -> User | None:
    """Ищет ДРУГОГО (не exclude_discord_id) бойца с таким же ИДН или Steam ID —
    при регистрации оба поля вводятся вручную, опечатка легко может случайно
    совпасть с чужой записью (см. app/api/registration.py)."""
    result = await db.execute(
        select(User).where(
            User.discord_id != exclude_discord_id,
            (User.service_id == service_id) | (User.steam_id == steam_id),
        )
    )
    return result.scalars().first()


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

    now = datetime.now(timezone.utc)
    if user is None:
        user = User(discord_id=discord_id, username=username, avatar_url=avatar_url, roles=roles, last_login_at=now)
        db.add(user)
    else:
        user.username = username
        user.avatar_url = avatar_url
        user.roles = roles
        user.last_login_at = now

    await db.commit()
    await db.refresh(user)
    return user


async def get_by_id(db: AsyncSession, user_id: int) -> User | None:
    return await db.get(User, user_id)


async def get_by_discord_ids(db: AsyncSession, discord_ids: list[str]) -> list[User]:
    if not discord_ids:
        return []
    result = await db.execute(
        select(User)
        .where(User.discord_id.in_(discord_ids))
        .options(selectinload(User.rank), selectinload(User.jedi_title))
    )
    return list(result.scalars().all())


async def count_active(db: AsyncSession) -> int:
    # approved + active, not "recently logged in"
    result = await db.execute(
        select(func.count(User.id)).where(User.registration_status == "approved", User.is_inactive.is_(False))
    )
    return int(result.scalar_one())


async def list_pending_registrations(db: AsyncSession) -> list[User]:
    """Заявки на регистрацию, уже реально поданные (service_id заполнен) и ещё
    не решённые — "pending" сразу после логина, до заполнения формы, сюда не
    попадает, чтобы не путать с уже отправленной на рассмотрение заявкой."""
    result = await db.execute(select(User).where(User.registration_status == "pending", User.service_id.isnot(None)))
    return list(result.scalars().all())


async def list_rejected_registrations(db: AsyncSession) -> list[User]:
    """Отклонённые заявки — показываются отдельно от ожидающих решения (см.
    решение пользователя), чтобы не терялись из виду: reject_registration
    обнуляет service_id/callsign/steam_id, поэтому здесь фильтр только по
    статусу, без проверки service_id."""
    result = await db.execute(select(User).where(User.registration_status == "rejected"))
    return list(result.scalars().all())


async def get_by_ids(db: AsyncSession, user_ids: list[int]) -> list[User]:
    if not user_ids:
        return []
    result = await db.execute(select(User).where(User.id.in_(user_ids)).options(selectinload(User.rank)))
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
        or (app_config.founder_role_id and app_config.founder_role_id in u.roles)
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

    # Переключение "неактивен" false->true — это фактически "выгнать" бойца из
    # формирования: профиль обнуляется, чтобы при реактивации он обязательно
    # прошёл регистрацию заново (см. app/api/registration.py), а не сохранил
    # старые ИДН/звание/позывной как ни в чём не бывало
    became_inactive = changes.get("is_inactive") is True and not user.is_inactive

    if "rank_id" in changes and changes["rank_id"] != user.rank_id:
        user.rank_assigned_at = datetime.now(timezone.utc) if changes["rank_id"] is not None else None

    for key, value in changes.items():
        setattr(user, key, value)

    if became_inactive:
        user.registration_status = "pending"
        user.service_id = None
        user.callsign = None
        user.nickname_override = None
        user.rank_id = None
        user.rank_assigned_at = None
        user.jedi_title_id = None

    await db.commit()
    await db.refresh(user, attribute_names=["rank", "jedi_title"])
    return user


async def set_rank_assigned_at(db: AsyncSession, user: User, *, days_in_rank: int) -> User:
    """Админ-панель: перематывает "дату получения текущего звания" назад на
    days_in_rank дней от текущего момента — это меняет days_in_rank, который видит
    и сверяет с требованием по выслуге /me/promotion-status."""
    user.rank_assigned_at = datetime.now(timezone.utc) - timedelta(days=days_in_rank)
    await db.commit()
    await db.refresh(user, attribute_names=["rank", "jedi_title"])
    return user
