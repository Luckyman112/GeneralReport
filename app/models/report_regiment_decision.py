import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class RegimentDecisionStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class ReportRegimentDecision(Base):
    """Решение ОДНОГО формирования-участника по совместному рапорту (см.
    ReportCategory.is_joint) — строка заводится автоматически при подаче для
    каждого формирования, реально обнаруженного среди участников. Командир
    этого формирования одобряет/отклоняет независимо от остальных — баллы
    участникам начисляются только по факту одобрения ИХ формированием (см.
    app/api/reports.py::decide_report_for_regiment)."""

    __tablename__ = "report_regiment_decisions"
    __table_args__ = (UniqueConstraint("report_id", "regiment_id", name="uq_report_regiment_decision"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    report_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("reports.id"))
    regiment_id: Mapped[int] = mapped_column(ForeignKey("regiments.id"))
    status: Mapped[RegimentDecisionStatus] = mapped_column(
        Enum(
            RegimentDecisionStatus,
            name="report_regiment_decision_status",
            values_callable=lambda enum_cls: [e.value for e in enum_cls],
        ),
        default=RegimentDecisionStatus.PENDING,
    )
    decided_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Зеркальная копия рапорта В ЭТОМ формировании — заводится один раз при первом
    # одобрении и переиспользуется при повторных toggle одобрить/отклонить (см.
    # app/api/reports.py) — не плодит дубли Report-строк
    mirror_report_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("reports.id"), nullable=True
    )

    regiment: Mapped["Regiment"] = relationship()
    decided_by_user: Mapped["User | None"] = relationship(foreign_keys=[decided_by])
