from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Notification(Base):
    """Уведомление — либо объявление от администрации (kind="broadcast", видно всем),
    либо автосозданное при подаче нарушения (kind="violation", видно командиру и
    заместителю формирования нарушителя — regiment_id)."""

    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(16))
    title: Mapped[str] = mapped_column(String(255))
    body: Mapped[str] = mapped_column(Text)
    # Для kind="violation" — формирование нарушителя, которому адресовано уведомление.
    # Для kind="broadcast" — None (видно всем)
    regiment_id: Mapped[int | None] = mapped_column(ForeignKey("regiments.id"), nullable=True)
    violation_id: Mapped[int | None] = mapped_column(ForeignKey("violations.id"), nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class NotificationRead(Base):
    """Отметка "прочитано" конкретным пользователем — проставляется целиком при
    открытии колокольчика уведомлений, а не по каждому сообщению отдельно."""

    __tablename__ = "notification_reads"

    notification_id: Mapped[int] = mapped_column(ForeignKey("notifications.id"), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), primary_key=True)
    read_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
