from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Violation(Base):
    """Запись о нарушении устава — заводится участником формирования из числа
    "писателей" (настраивается админом, по умолчанию — Гвардия). target_regiment_id
    определяется автоматически по текущей Discord-роли нарушителя на момент подачи
    (для маршрутизации уведомления его командиру/заместителю)."""

    __tablename__ = "violations"

    id: Mapped[int] = mapped_column(primary_key=True)
    target_discord_id: Mapped[str] = mapped_column(String(32))
    # Снимок ника нарушителя на момент подачи — на случай если он позже сменит ник
    # или покинет сервер
    target_username: Mapped[str] = mapped_column(String(255))
    target_regiment_id: Mapped[int | None] = mapped_column(ForeignKey("regiments.id"), nullable=True)
    description: Mapped[str] = mapped_column(Text)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    author: Mapped["User"] = relationship(foreign_keys=[created_by])
