import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class EventMessageStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class EventMessage(Base):
    """Заявка на свободное сообщение по уже одобренному ивенту — автор ивента
    пишет текст, Ассистент+/Куратор одобряет/отклоняет, и только после
    одобрения появляется возможность реально отправить его в Discord (кнопку
    может нажать и автор, и Ассистент+/Куратор, см. решение пользователя).
    Отдельная сущность от Event (не встроенное поле), может быть несколько
    штук на один ивент — каждая проходит свой цикл pending -> approved/rejected."""

    __tablename__ = "event_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id"))
    content: Mapped[str] = mapped_column(Text)
    status: Mapped[EventMessageStatus] = mapped_column(
        Enum(EventMessageStatus, name="event_message_status", values_callable=lambda e: [x.value for x in e]),
        default=EventMessageStatus.PENDING,
    )
    submitted_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    decided_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    # отправлено в Discord — отдельно от "одобрено", чтобы кнопка "Отправить"
    # пропадала после первого нажатия (защита от повторной отправки) и было
    # видно, что уже реально ушло в канал, а не просто одобрено
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sent_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    event: Mapped["Event"] = relationship(foreign_keys=[event_id])
    submitted_by: Mapped["User"] = relationship(foreign_keys=[submitted_by_user_id])
    decided_by: Mapped["User | None"] = relationship(foreign_keys=[decided_by_user_id])
    sent_by: Mapped["User | None"] = relationship(foreign_keys=[sent_by_user_id])
