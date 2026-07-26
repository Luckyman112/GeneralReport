from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class LeaveRequest(Base):
    """Заявка на отпуск — конкретные даты "с — по" + причина. Одобряет
    заместитель/командир/высшее командование/админ формирования."""

    __tablename__ = "leave_requests"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    regiment_id: Mapped[int] = mapped_column(ForeignKey("regiments.id"))
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    reason: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default="pending", server_default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    decided_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped["User"] = relationship(foreign_keys=[user_id])
