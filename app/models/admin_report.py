import enum
from datetime import datetime

from sqlalchemy import JSON, DateTime, Enum, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class AdminReportStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class AdminReport(Base):
    """Отчёт Администрации (нон-РП должность, см. app/models/app_settings.py::
    admin_staff_*_role_id) — "Отчёт деятельности" или "Отчёт наказаний".
    Отдельная сущность от Report/ReportCategory, тот же принцип, что у Event
    (Ивентрум) — не завязана на Regiment, набор полей формуляра зашит на
    фронте (AdminStaffPage.jsx), payload хранит их как есть."""

    __tablename__ = "admin_reports"

    id: Mapped[int] = mapped_column(primary_key=True)
    report_type: Mapped[str] = mapped_column(String(16))  # "activity" | "punishment"
    payload: Mapped[dict] = mapped_column(JSON, default=dict, server_default="{}")
    status: Mapped[AdminReportStatus] = mapped_column(
        Enum(AdminReportStatus, name="admin_report_status", values_callable=lambda e: [x.value for x in e]),
        default=AdminReportStatus.PENDING,
    )
    submitted_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    decided_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Отчёт деятельности может быть отклонён без указания причины (см. решение
    # пользователя) — поле необязательно для обоих типов
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    submitted_by: Mapped["User"] = relationship(foreign_keys=[submitted_by_user_id])
    decided_by: Mapped["User | None"] = relationship(foreign_keys=[decided_by_user_id])
