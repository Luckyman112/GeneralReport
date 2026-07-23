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
) -> AppSettings:
    """Частичное обновление: None = поле не передано (не трогаем), пустая строка =
    явно очистить роль (сохраняем как NULL в БД)."""
    row = await get(db)
    if admin_role_id is not None:
        row.admin_role_id = admin_role_id or None
    if commander_role_id is not None:
        row.commander_role_id = commander_role_id or None
    if deputy_role_id is not None:
        row.deputy_role_id = deputy_role_id or None
    await db.commit()
    await db.refresh(row)
    return row


async def update_violation_regiments(
    db: AsyncSession,
    *,
    writer_regiment_ids: list[int] | None = None,
    viewer_regiment_ids: list[int] | None = None,
) -> AppSettings:
    """Списки формирований для модуля "Нарушители". None = поле не передано (не
    трогаем) — отличать от пустого списка (явно "никто, кроме админа") позволяет
    exclude_unset в эндпоинте."""
    row = await get(db)
    if writer_regiment_ids is not None:
        row.violation_writer_regiment_ids = writer_regiment_ids
    if viewer_regiment_ids is not None:
        row.violation_viewer_regiment_ids = viewer_regiment_ids
    await db.commit()
    await db.refresh(row)
    return row
