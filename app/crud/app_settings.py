from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.app_settings import AppSettings

SETTINGS_ID = 1


async def get(db: AsyncSession) -> AppSettings:
    """Возвращает singleton-строку настроек, создавая её при первом обращении
    с бутстрап-значениями из .env (для admin/commander; для deputy фолбэка нет)."""
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


async def update(
    db: AsyncSession,
    *,
    admin_role_id: str | None = None,
    commander_role_id: str | None = None,
    deputy_role_id: str | None = None,
    high_command_role_id: str | None = None,
    admin_user_discord_ids: list[str] | None = None,
) -> AppSettings:
    """Частичное обновление: None = поле не передано (не трогаем), пустая строка =
    явно очистить роль (сохраняем как NULL в БД). admin_user_discord_ids — список,
    так что "не передано" отличаем через отдельный сигнальный default (см. эндпоинт)."""
    row = await get(db)
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
    await db.commit()
    await db.refresh(row)
    return row


async def update_module_access(db: AsyncSession, **changes) -> AppSettings:
    """Настройки доступа к модулю "Нарушители" + рассылке + кнопке рапорта о
    задержании — только реально переданные клиентом поля (exclude_unset в
    эндпоинте), поэтому пустой список здесь означает явное "никто" (кроме
    администратора/высшего командования, у них доступ всегда есть)."""
    row = await get(db)
    for key, value in changes.items():
        setattr(row, key, value)
    await db.commit()
    await db.refresh(row)
    return row
