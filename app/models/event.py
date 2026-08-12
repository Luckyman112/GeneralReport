import enum
from datetime import datetime

from sqlalchemy import JSON, DateTime, Enum, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class EventStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    CANCELLED = "cancelled"


class Event(Base):
    """Заявка на ивент из Ивентрума — отдельная сущность от Report (см. решение
    пользователя: своя таблица/UI, а не категория рапорта). Набор пользовательских
    полей заранее не фиксирован — payload хранит их как есть, конкретная форма
    зашита на фронте (см. EventRoomPage.jsx), без конструктора полей в БД."""

    __tablename__ = "events"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(255))
    # произвольные поля формы ивента (дата/время, локация, описание и т.д.) —
    # набор задаётся на фронте, бэкенд их не валидирует по отдельности
    payload: Mapped[dict] = mapped_column(JSON, default=dict, server_default="{}")
    status: Mapped[EventStatus] = mapped_column(
        Enum(EventStatus, name="event_status", values_callable=lambda enum_cls: [e.value for e in enum_cls]),
        default=EventStatus.PENDING,
    )
    submitted_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    decided_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    # заполняется, когда бот успешно отправил сообщение в канал при одобрении —
    # позволяет отличить "одобрено, но отправка не удалась" от "всё прошло"
    notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # id отправленного ботом сообщения в Discord — при дозаполнении заявки после
    # одобрения бот РЕДАКТИРУЕТ это же сообщение вместо отправки нового (см.
    # решение пользователя); канал берётся из текущих настроек, не хранится тут
    discord_message_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # отмена уже одобренной заявки (см. решение пользователя) — отдельные поля
    # от decided_by/decided_at, чтобы не терять, кто и когда изначально одобрил
    cancelled_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancellation_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    submitted_by: Mapped["User"] = relationship(foreign_keys=[submitted_by_user_id])
    decided_by: Mapped["User | None"] = relationship(foreign_keys=[decided_by_user_id])
    cancelled_by: Mapped["User | None"] = relationship(foreign_keys=[cancelled_by_user_id])


class EventMap(Base):
    """Каталог карт для выбора в заявке на ивент — список правят только
    Ассистент/Куратор ивентологии (см. решение пользователя).

    url — ссылка на карту, вставляется как гиперссылка в поле "Карта" карточки
    в Discord. Информация о планете (название/система/ландшафт/погода/флора и
    фауна) раньше жила здесь, на карте — переехала в саму заявку на ивент
    (Event.payload), потому что планета привязана к конкретному ивенту, а не
    к переиспользуемой карте (см. решение пользователя)."""

    __tablename__ = "event_maps"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), unique=True)
    url: Mapped[str | None] = mapped_column(String(500), nullable=True)
