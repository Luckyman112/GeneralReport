import enum
from datetime import datetime

from sqlalchemy import JSON, DateTime, Enum, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class EventActivityReportStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class EventActivityReport(Base):
    """Отчёт Ивентолога о проведённом мероприятии (Мини-ивент / Боевой вылет) —
    отдельная сущность от Event (тот — заявка/бронь ДО ивента, этот —
    отчётность ПОСЛЕ). Тот же принцип freeform payload, что у Event/AdminReport."""

    __tablename__ = "event_activity_reports"

    id: Mapped[int] = mapped_column(primary_key=True)
    event_type: Mapped[str] = mapped_column(String(16))  # "mini" | "combat"
    payload: Mapped[dict] = mapped_column(JSON, default=dict, server_default="{}")
    status: Mapped[EventActivityReportStatus] = mapped_column(
        Enum(
            EventActivityReportStatus,
            name="event_activity_report_status",
            values_callable=lambda e: [x.value for x in e],
        ),
        default=EventActivityReportStatus.PENDING,
    )
    submitted_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    decided_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    submitted_by: Mapped["User"] = relationship(foreign_keys=[submitted_by_user_id])
    decided_by: Mapped["User | None"] = relationship(foreign_keys=[decided_by_user_id])
