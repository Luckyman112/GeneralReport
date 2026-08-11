from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.exceptions import AppError
from app.models.event_booking import EventBooking, EventBookingStatus
from app.models.user import User

# .selectinload(User.rank) обязателен — UserBrief.rank читается синхронно при
# сериализации ответа; без eager load это ленивая relationship, а обращение к
# ней вне await в асинхронном SQLAlchemy падает MissingGreenlet (500) —
# баг-репорт: GET /event-bookings падал 500, как только в выбранном диапазоне
# попадалась хоть одна бронь, тот же паттерн, что уже учтён в app/crud/event.py.
_LOAD_OPTIONS = [
    selectinload(EventBooking.requested_by).selectinload(User.rank),
    selectinload(EventBooking.decided_by).selectinload(User.rank),
]


async def list_in_range(db: AsyncSession, *, range_start: datetime, range_end: datetime) -> list[EventBooking]:
    """Все брони (любого статуса — отклонённые тоже видны, чтобы было понятно,
    что слот освободился) с пересечением диапазона [range_start, range_end)."""
    result = await db.execute(
        select(EventBooking)
        .options(*_LOAD_OPTIONS)
        .where(EventBooking.starts_at < range_end, EventBooking.ends_at > range_start)
        .order_by(EventBooking.starts_at)
    )
    return list(result.scalars().all())


async def get_by_id(db: AsyncSession, booking_id: int) -> EventBooking | None:
    return await db.get(EventBooking, booking_id, options=_LOAD_OPTIONS, populate_existing=True)


async def list_for_user(
    db: AsyncSession, *, user_id: int, status: EventBookingStatus = EventBookingStatus.APPROVED
) -> list[EventBooking]:
    """Одобренные брони бойца, независимо от даты — для выбора в форме подачи
    заявки на ивент (см. EventForm)."""
    result = await db.execute(
        select(EventBooking)
        .options(*_LOAD_OPTIONS)
        .where(EventBooking.requested_by_user_id == user_id, EventBooking.status == status)
        .order_by(EventBooking.starts_at)
    )
    return list(result.scalars().all())


async def create(
    db: AsyncSession, *, title: str, starts_at: datetime, ends_at: datetime, requested_by_user_id: int
) -> EventBooking:
    row = EventBooking(title=title, starts_at=starts_at, ends_at=ends_at, requested_by_user_id=requested_by_user_id)
    db.add(row)
    await db.commit()
    return await db.get(EventBooking, row.id, options=_LOAD_OPTIONS, populate_existing=True)


async def decide(
    db: AsyncSession, booking: EventBooking, *, approve: bool, decided_by_user_id: int, rejection_reason: str | None = None
) -> EventBooking:
    # Защита от повторного решения (двойной клик/повтор запроса) — см.
    # app/crud/event.py::decide и promotion_crud.decide, тот же паттерн
    if booking.status != EventBookingStatus.PENDING:
        raise AppError("Бронь уже решена — повторное решение по ней невозможно")
    booking.status = EventBookingStatus.APPROVED if approve else EventBookingStatus.REJECTED
    booking.decided_by_user_id = decided_by_user_id
    booking.decided_at = datetime.now(timezone.utc)
    booking.rejection_reason = rejection_reason
    await db.commit()
    return await db.get(EventBooking, booking.id, options=_LOAD_OPTIONS, populate_existing=True)


async def cancel(db: AsyncSession, booking: EventBooking, *, cancelled_by_user_id: int, reason: str | None) -> EventBooking:
    """Отмена уже одобренной брони — переиспользует REJECTED (см. решение
    пользователя), отдельный CANCELLED не нужен: у брони нет Discord-карточки,
    которую надо специально помечать."""
    if booking.status != EventBookingStatus.APPROVED:
        raise AppError("Отменить можно только уже одобренную бронь")
    booking.status = EventBookingStatus.REJECTED
    booking.decided_by_user_id = cancelled_by_user_id
    booking.decided_at = datetime.now(timezone.utc)
    booking.rejection_reason = reason or "Отменено после одобрения"
    await db.commit()
    return await db.get(EventBooking, booking.id, options=_LOAD_OPTIONS, populate_existing=True)
