"""Календарь бронирования дат/времени под ивенты — до проведения слот нужно
занять; бронь сразу одобрена (см. решение пользователя — отдельный шаг
одобрения убран), а overlap-check не пускает два ивентолога забронировать
пересекающееся время."""
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
from app.schemas.event_booking import EventBookingCancelRequest, EventBookingCreate, EventBookingRead

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


@router.get("/mine", response_model=list[EventBookingRead])
async def list_my_bookings(
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[EventBookingRead]:
    """Свои одобренные брони — для выбора в форме подачи заявки на ивент (см.
    решение пользователя: одобренное время появляется в форме)."""
    if not access.is_event_submitter:
        raise ForbiddenError("Доступно только Ивентологам")
    bookings = await event_booking_crud.list_for_user(db, user_id=access.user.id)
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


@router.post("/{booking_id}/cancel", response_model=EventBookingRead)
async def cancel_booking(
    booking_id: int,
    payload: EventBookingCancelRequest,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> EventBookingRead:
    """Отмена уже одобренной брони — переиспользует REJECTED, у брони нет
    Discord-карточки, которую надо помечать отдельно (см. решение
    пользователя)."""
    if not access.can_decide_event:
        raise ForbiddenError("Отменить одобренную бронь может Ассистент/Куратор ивентологии")
    booking = await event_booking_crud.get_by_id(db, booking_id)
    if booking is None:
        raise NotFoundError("Бронь не найдена")
    reason = (payload.reason or "").strip() or None
    updated = await event_booking_crud.cancel(db, booking, cancelled_by_user_id=access.user.id, reason=reason)
    logger.info("%s отменил одобренную бронь %s", access.user.username, booking_id)
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="event_booking_cancel",
        details=f"Отменил одобренную бронь {booking_id} ({booking.title})",
    )
    # Раньше тут читались payload.status/payload.rejection_reason, которых у
    # EventBookingCancelRequest нет: бронь отменялась, но ответ падал 500 и
    # куратор видел ошибку. У отмены есть только reason.
    await notification_crud.create_personal_notification(
        db,
        target_user_id=updated.requested_by_user_id,
        title="Бронь отменена",
        body=f"Ваша бронь «{updated.title}» отменена." + (f" Причина: {reason}" if reason else ""),
        created_by=access.user.id,
    )
    return EventBookingRead.model_validate(updated)


@router.post("/{booking_id}/approve", response_model=EventBookingRead)
async def approve_booking(
    booking_id: int,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> EventBookingRead:
    """Вернуть отменённую бронь — например, ивент перенесли обратно. Тот же
    запрет на пересечение, что и при создании."""
    if not access.can_decide_event:
        raise ForbiddenError("Одобрить бронь может Ассистент/Куратор ивентологии")
    booking = await event_booking_crud.get_by_id(db, booking_id)
    if booking is None:
        raise NotFoundError("Бронь не найдена")
    if booking.ends_at <= datetime.now(timezone.utc):
        raise AppError("Время этой брони уже прошло")
    overlapping = await event_booking_crud.list_in_range(db, range_start=booking.starts_at, range_end=booking.ends_at)
    if any(b.id != booking.id and b.status != "rejected" for b in overlapping):
        raise AppError("На это время уже есть другая бронь")
    title = booking.title
    updated = await event_booking_crud.restore(db, booking, approved_by_user_id=access.user.id)
    logger.info("%s вернул бронь %s", access.user.username, booking_id)
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="event_booking_approve",
        details=f"Вернул бронь {booking_id} ({title})",
    )
    await notification_crud.create_personal_notification(
        db,
        target_user_id=updated.requested_by_user_id,
        title="Бронь одобрена",
        body=f"Ваша бронь «{title}» снова действует.",
        created_by=access.user.id,
    )
    return EventBookingRead.model_validate(updated)
