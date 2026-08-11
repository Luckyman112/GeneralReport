from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.exceptions import AppError
from app.models.event_message import EventMessage, EventMessageStatus

_LOAD_OPTIONS = [
    selectinload(EventMessage.submitted_by),
    selectinload(EventMessage.decided_by),
    selectinload(EventMessage.sent_by),
]


async def list_for_event(db: AsyncSession, *, event_id: int) -> list[EventMessage]:
    result = await db.execute(
        select(EventMessage)
        .options(*_LOAD_OPTIONS)
        .where(EventMessage.event_id == event_id)
        .order_by(EventMessage.created_at)
    )
    return list(result.scalars().all())


async def list_for_events(db: AsyncSession, *, event_ids: list[int]) -> dict[int, list[EventMessage]]:
    """Батч-версия list_for_event — используется при сборке списка заявок на
    ивент разом, чтобы не делать по запросу на каждую (см. EventRead.messages)."""
    if not event_ids:
        return {}
    result = await db.execute(
        select(EventMessage)
        .options(*_LOAD_OPTIONS)
        .where(EventMessage.event_id.in_(event_ids))
        .order_by(EventMessage.created_at)
    )
    by_event: dict[int, list[EventMessage]] = {}
    for row in result.scalars().all():
        by_event.setdefault(row.event_id, []).append(row)
    return by_event


async def get_by_id(db: AsyncSession, message_id: int) -> EventMessage | None:
    return await db.get(EventMessage, message_id, options=_LOAD_OPTIONS, populate_existing=True)


async def create(db: AsyncSession, *, event_id: int, content: str, submitted_by_user_id: int) -> EventMessage:
    row = EventMessage(event_id=event_id, content=content, submitted_by_user_id=submitted_by_user_id)
    db.add(row)
    await db.commit()
    return await db.get(EventMessage, row.id, options=_LOAD_OPTIONS, populate_existing=True)


async def decide(
    db: AsyncSession, message: EventMessage, *, approve: bool, decided_by_user_id: int, rejection_reason: str | None = None
) -> EventMessage:
    if message.status != EventMessageStatus.PENDING:
        raise AppError("Заявка на сообщение уже решена — повторное решение по ней невозможно")
    message.status = EventMessageStatus.APPROVED if approve else EventMessageStatus.REJECTED
    message.decided_by_user_id = decided_by_user_id
    message.decided_at = datetime.now(timezone.utc)
    message.rejection_reason = rejection_reason
    await db.commit()
    return await db.get(EventMessage, message.id, options=_LOAD_OPTIONS, populate_existing=True)


async def mark_sent(db: AsyncSession, message: EventMessage, *, sent_by_user_id: int) -> EventMessage:
    if message.status != EventMessageStatus.APPROVED:
        raise AppError("Отправить можно только одобренное сообщение")
    if message.sent_at is not None:
        raise AppError("Сообщение уже отправлено")
    message.sent_at = datetime.now(timezone.utc)
    message.sent_by_user_id = sent_by_user_id
    await db.commit()
    return await db.get(EventMessage, message.id, options=_LOAD_OPTIONS, populate_existing=True)
