import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class EventBookingStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class EventBooking(Base):
    """Бронь даты/времени под ивент — до проведения нужно "занять" слот,
    одобряет Ассистент+/Куратор (см. решение пользователя), чтобы два
    ивентолога не забронировали один и тот же промежуток. Отдельная от Event
    (заявка на конкретный ивент, с локацией/сюжетом) — бронь может быть заранее,
    без готовой заявки ещё."""

    __tablename__ = "event_bookings"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(255))
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[EventBookingStatus] = mapped_column(
        Enum(EventBookingStatus, name="event_booking_status", values_callable=lambda e: [x.value for x in e]),
        default=EventBookingStatus.PENDING,
    )
    requested_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    decided_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    requested_by: Mapped["User"] = relationship(foreign_keys=[requested_by_user_id])
    decided_by: Mapped["User | None"] = relationship(foreign_keys=[decided_by_user_id])
