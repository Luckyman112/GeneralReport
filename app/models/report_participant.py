import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Integer, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.report import Report
    from app.models.user import User


class ReportParticipant(Base):
    """Начисление баллов участнику рапорта (не автору) — тем, кто указан в
    ростер-полях категории. Создаётся при одобрении рапорта, если у категории
    задан participant_points; количество/наличие определяет полноправный
    командир/высшее командование/админ при настройке категории."""

    __tablename__ = "report_participants"

    id: Mapped[int] = mapped_column(primary_key=True)
    report_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("reports.id"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    points: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    report: Mapped["Report"] = relationship()
    user: Mapped["User"] = relationship()
