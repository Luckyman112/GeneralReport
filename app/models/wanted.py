from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

# Причина снятия с розыска — фиксированный набор, выбирается тем, кто снимает
# (см. решение пользователя)
WANTED_RESOLUTIONS = ("detained", "arrested", "eliminated", "missing", "punished")


class WantedEntry(Base):
    """Запись в розыске — виден всем бойцам независимо от роли (в отличие от
    "Нарушители", доступ к которым ограничен), заводить/снимать может тот же
    круг лиц, что и подавать рапорт о задержании (см. AccessContext.
    can_file_detention_report). Разыскиваемый не обязательно есть в текущем
    составе Discord-сервера, поэтому звание/формирование — те же справочники,
    что и у Violation.target_rank_id/target_regiment_id, а не обязаны совпадать
    с текущими данными бойца."""

    __tablename__ = "wanted_entries"

    id: Mapped[int] = mapped_column(primary_key=True)
    nickname: Mapped[str] = mapped_column(String(255))
    service_id: Mapped[str | None] = mapped_column(String(4), nullable=True)
    rank_id: Mapped[int | None] = mapped_column(ForeignKey("ranks.id"), nullable=True)
    regiment_id: Mapped[int | None] = mapped_column(ForeignKey("regiments.id"), nullable=True)
    reason: Mapped[str] = mapped_column(Text)

    status: Mapped[str] = mapped_column(String(16), default="active", server_default="active")
    resolution: Mapped[str | None] = mapped_column(String(16), nullable=True)

    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    resolved_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    rank: Mapped["Rank | None"] = relationship(foreign_keys=[rank_id])
    regiment: Mapped["Regiment | None"] = relationship(foreign_keys=[regiment_id])
    author: Mapped["User"] = relationship(foreign_keys=[created_by])
    resolved_by_user: Mapped["User | None"] = relationship(foreign_keys=[resolved_by])
