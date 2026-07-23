from sqlalchemy import delete as sa_delete
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.notification import Notification, NotificationRead
from app.models.violation import Violation

_LOAD_OPTIONS = [selectinload(Violation.author)]


async def list_all(db: AsyncSession) -> list[Violation]:
    result = await db.execute(select(Violation).options(*_LOAD_OPTIONS).order_by(Violation.created_at.desc()))
    return list(result.scalars().all())


async def get_by_id(db: AsyncSession, violation_id: int) -> Violation | None:
    return await db.get(Violation, violation_id, options=_LOAD_OPTIONS, populate_existing=True)


async def create(
    db: AsyncSession,
    *,
    target_discord_id: str,
    target_username: str,
    target_regiment_id: int | None,
    description: str,
    created_by: int,
) -> Violation:
    violation = Violation(
        target_discord_id=target_discord_id,
        target_username=target_username,
        target_regiment_id=target_regiment_id,
        description=description,
        created_by=created_by,
    )
    db.add(violation)
    await db.commit()
    return await get_by_id(db, violation.id)


async def delete(db: AsyncSession, violation: Violation) -> None:
    """Удаляет и уведомление, автосозданное при подаче этого нарушения (вместе с
    отметками "прочитано" по нему) — иначе внешний ключ notifications.violation_id
    не даст удалить саму запись."""
    notification_ids_result = await db.execute(
        select(Notification.id).where(Notification.violation_id == violation.id)
    )
    notification_ids = list(notification_ids_result.scalars().all())
    if notification_ids:
        await db.execute(sa_delete(NotificationRead).where(NotificationRead.notification_id.in_(notification_ids)))
        await db.execute(sa_delete(Notification).where(Notification.id.in_(notification_ids)))

    await db.delete(violation)
    await db.commit()
