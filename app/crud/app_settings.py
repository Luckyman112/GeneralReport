import time
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.app_settings import AppSettings

SETTINGS_ID = 1

# app_settings читается почти на каждый запрос (get_access_context и т.д.) — это
# singleton-строка, которая меняется очень редко, так что держим короткий кэш в
# памяти процесса вместо похода в БД на каждый чих. Кэшируем "снимок" (expunge из
# сессии) — атрибуты уже загружены и не протухают при закрытии чужой сессии,
# в отличие от обычного ORM-объекта, который SQLAlchemy expire'ит после commit.
_CACHE_TTL_SECONDS = 30
_cached_row: AppSettings | None = None
_cached_at: float = 0.0


def _remember(row: AppSettings, db: AsyncSession) -> None:
    global _cached_row, _cached_at
    db.expunge(row)
    _cached_row = row
    _cached_at = time.monotonic()


async def _fetch_live(db: AsyncSession) -> AppSettings:
    row = await db.get(AppSettings, SETTINGS_ID)
    if row is None:
        row = AppSettings(
            id=SETTINGS_ID,
            admin_role_id=settings.admin_role_id,
            commander_role_id=settings.commander_role_id,
            deputy_role_id=None,
        )
        db.add(row)
        await db.commit()
        await db.refresh(row)
    return row


async def get(db: AsyncSession) -> AppSettings:
    """Возвращает singleton-строку настроек (из короткого кэша, если он ещё свежий),
    создавая её при первом обращении с бутстрап-значениями из .env (для
    admin/commander; для deputy фолбэка нет)."""
    now = time.monotonic()
    if _cached_row is not None and (now - _cached_at) < _CACHE_TTL_SECONDS:
        return _cached_row

    row = await _fetch_live(db)
    _remember(row, db)
    return row


async def update(
    db: AsyncSession,
    *,
    admin_role_id: str | None = None,
    commander_role_id: str | None = None,
    deputy_role_id: str | None = None,
    high_command_role_id: str | None = None,
    admin_user_discord_ids: list[str] | None = None,
    founder_role_id: str | None = None,
    instructor_role_id: str | None = None,
    password_login_authorized_discord_id: str | None = None,
) -> AppSettings:
    """Частичное обновление: None = поле не передано (не трогаем), пустая строка =
    явно очистить роль (сохраняем как NULL в БД). admin_user_discord_ids — список,
    так что "не передано" отличаем через отдельный сигнальный default (см. эндпоинт)."""
    row = await _fetch_live(db)
    if admin_role_id is not None:
        row.admin_role_id = admin_role_id or None
    if commander_role_id is not None:
        row.commander_role_id = commander_role_id or None
    if deputy_role_id is not None:
        row.deputy_role_id = deputy_role_id or None
    if high_command_role_id is not None:
        row.high_command_role_id = high_command_role_id or None
    if admin_user_discord_ids is not None:
        row.admin_user_discord_ids = admin_user_discord_ids
    if founder_role_id is not None:
        row.founder_role_id = founder_role_id or None
    if instructor_role_id is not None:
        row.instructor_role_id = instructor_role_id or None
    if password_login_authorized_discord_id is not None:
        row.password_login_authorized_discord_id = password_login_authorized_discord_id or None
    await db.commit()
    await db.refresh(row)
    _remember(row, db)
    return row


async def set_maintenance_mode(db: AsyncSession, *, enabled: bool, message: str | None) -> AppSettings:
    row = await _fetch_live(db)
    row.maintenance_mode = enabled
    row.maintenance_message = message
    await db.commit()
    await db.refresh(row)
    _remember(row, db)
    return row


async def revoke_all_sessions(db: AsyncSession) -> AppSettings:
    # invalidates all tokens issued before now, including caller's own
    row = await _fetch_live(db)
    row.sessions_revoked_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(row)
    _remember(row, db)
    return row


async def update_module_access(db: AsyncSession, **changes) -> AppSettings:
    """Настройки доступа к модулю "Нарушители" + рассылке + кнопке рапорта о
    задержании — только реально переданные клиентом поля (exclude_unset в
    эндпоинте), поэтому пустой список здесь означает явное "никто" (кроме
    администратора/высшего командования, у них доступ всегда есть)."""
    row = await _fetch_live(db)
    for key, value in changes.items():
        setattr(row, key, value)
    await db.commit()
    await db.refresh(row)
    _remember(row, db)
    return row
