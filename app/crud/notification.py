from sqlalchemy import or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import Notification, NotificationRead


async def list_for_user(db: AsyncSession, *, user_id: int, commander_regiment_ids: set[int]) -> list[Notification]:
    """Объявления от администрации (видны всем) + уведомления о нарушениях бойцов
    своего формирования (видны только командиру/заместителю этого формирования)."""
    conditions = [Notification.kind == "broadcast"]
    if commander_regiment_ids:
        conditions.append(Notification.regiment_id.in_(commander_regiment_ids))

    query = select(Notification).where(or_(*conditions)).order_by(Notification.created_at.desc())
    result = await db.execute(query)
    return list(result.scalars().all())


async def get_read_ids(db: AsyncSession, *, user_id: int, notification_ids: list[int]) -> set[int]:
    if not notification_ids:
        return set()
    result = await db.execute(
        select(NotificationRead.notification_id).where(
            NotificationRead.user_id == user_id,
            NotificationRead.notification_id.in_(notification_ids),
        )
    )
    return set(result.scalars().all())


async def mark_all_read(db: AsyncSession, *, user_id: int, notification_ids: list[int]) -> None:
    if not notification_ids:
        return
    # ON CONFLICT DO NOTHING — уведомление могло быть уже отмечено прочитанным раньше
    stmt = pg_insert(NotificationRead).values(
        [{"notification_id": nid, "user_id": user_id} for nid in notification_ids]
    )
    stmt = stmt.on_conflict_do_nothing(index_elements=["notification_id", "user_id"])
    await db.execute(stmt)
    await db.commit()


async def create_broadcast(db: AsyncSession, *, title: str, body: str, created_by: int) -> Notification:
    notification = Notification(kind="broadcast", title=title, body=body, created_by=created_by)
    db.add(notification)
    await db.commit()
    await db.refresh(notification)
    return notification


async def create_violation_notification(
    db: AsyncSession, *, regiment_id: int, violation_id: int, title: str, body: str, created_by: int
) -> Notification:
    notification = Notification(
        kind="violation",
        title=title,
        body=body,
        regiment_id=regiment_id,
        violation_id=violation_id,
        created_by=created_by,
    )
    db.add(notification)
    await db.commit()
    await db.refresh(notification)
    return notification
