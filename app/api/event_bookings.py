"""Календарь бронирования дат/времени под ивенты — до проведения слот нужно
занять, одобряет Ассистент/Куратор ивентологии (см. решение пользователя),
чтобы два ивентолога не забронировали пересекающееся время."""
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AccessContext, get_access_context
from app.crud import audit_log as audit_log_crud
from app.crud import event_booking as event_booking_crud
from app.crud import notification as notification_crud
from app.database import get_db
from app.exceptions import AppError, ForbiddenError, NotFoundError
from app.schemas.event_booking import EventBookingCreate, EventBookingDecide, EventBookingRead

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/event-bookings", tags=["event-bookings"])


@router.get("", response_model=list[EventBookingRead])
async def list_bookings(
    range_start: datetime = Query(...),
    range_end: datetime = Query(...),
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[EventBookingRead]:
    """Все брони (любого статуса) в диапазоне — виден всем Ивентологам, чтобы
    было видно, какие даты/время уже заняты."""
    if not access.is_event_submitter:
        raise ForbiddenError("Доступно только Ивентологам")
    if range_end <= range_start:
        raise AppError("Некорректный диапазон дат")
    bookings = await event_booking_crud.list_in_range(db, range_start=range_start, range_end=range_end)
    return [EventBookingRead.model_validate(b) for b in bookings]


@router.post("", response_model=EventBookingRead, status_code=201)
async def create_booking(
    payload: EventBookingCreate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> EventBookingRead:
    if not access.is_event_submitter:
        raise ForbiddenError("Доступно только Ивентологам")
    if payload.ends_at <= payload.starts_at:
        raise AppError("Время окончания должно быть позже времени начала")
    if payload.starts_at < datetime.now(timezone.utc) - timedelta(minutes=5):
        raise AppError("Нельзя забронировать время в прошлом")

    overlapping = await event_booking_crud.list_in_range(
        db, range_start=payload.starts_at, range_end=payload.ends_at
    )
    if any(b.status != "rejected" for b in overlapping):
        raise AppError("На это время уже есть бронь (ожидающая решения или одобренная)")

    booking = await event_booking_crud.create(
        db,
        title=payload.title.strip(),
        starts_at=payload.starts_at,
        ends_at=payload.ends_at,
        requested_by_user_id=access.user.id,
    )
    logger.info("%s забронировал слот под ивент: %s", access.user.username, payload.title)
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="event_booking_create",
        details=f"Бронь {booking.id} ({payload.title})",
    )
    return EventBookingRead.model_validate(booking)


@router.patch("/{booking_id}", response_model=EventBookingRead)
async def decide_booking(
    booking_id: int,
    payload: EventBookingDecide,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> EventBookingRead:
    if not access.can_decide_event:
        raise ForbiddenError("Одобрять брони может Ассистент/Куратор ивентологии")
    booking = await event_booking_crud.get_by_id(db, booking_id)
    if booking is None:
        raise NotFoundError("Бронь не найдена")
    updated = await event_booking_crud.decide(
        db,
        booking,
        approve=payload.status == "approved",
        decided_by_user_id=access.user.id,
        rejection_reason=payload.rejection_reason,
    )
    logger.info("%s решил по брони %s: %s", access.user.username, booking_id, payload.status)
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="event_booking_decide",
        details=f"Бронь {booking_id} ({booking.title}) -> {payload.status}",
    )
    await notification_crud.create_personal_notification(
        db,
        target_user_id=updated.requested_by_user_id,
        title="Бронь одобрена" if payload.status == "approved" else "Бронь отклонена",
        body=f"Ваша бронь «{booking.title}» {'одобрена' if payload.status == 'approved' else 'отклонена'}."
        + (f" Причина: {payload.rejection_reason}" if payload.status == "rejected" and payload.rejection_reason else ""),
        created_by=access.user.id,
    )
    return EventBookingRead.model_validate(updated)
