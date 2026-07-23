from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Violation(Base):
    """Запись о нарушении устава — заводится участником формирования из числа
    "писателей" (настраивается админом, по умолчанию — Гвардия).

    Нарушитель либо выбирается из реального состава Discord-сервера (тогда
    заполняются target_discord_id/target_username, а target_regiment_id
    определяется автоматически по его текущей Discord-роли), либо — если его нет
    среди пользователей Discord — вводится вручную (target_service_id/target_rank_id/
    target_callsign + явный выбор target_regiment_id)."""

    __tablename__ = "violations"

    id: Mapped[int] = mapped_column(primary_key=True)
    target_discord_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # Снимок ника нарушителя на момент подачи (только для Discord-варианта) — на
    # случай если он позже сменит ник или покинет сервер
    target_username: Mapped[str | None] = mapped_column(String(255), nullable=True)
    target_regiment_id: Mapped[int | None] = mapped_column(ForeignKey("regiments.id"), nullable=True)
    # Ручной ввод (когда нарушителя нет среди пользователей Discord)
    target_service_id: Mapped[str | None] = mapped_column(String(4), nullable=True)
    target_rank_id: Mapped[int | None] = mapped_column(ForeignKey("ranks.id"), nullable=True)
    target_callsign: Mapped[str | None] = mapped_column(String(255), nullable=True)
    description: Mapped[str] = mapped_column(Text)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    author: Mapped["User"] = relationship(foreign_keys=[created_by])
    target_rank: Mapped["Rank | None"] = relationship()
