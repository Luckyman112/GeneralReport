import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class ReportStatus(str, enum.Enum):
    DRAFT = "draft"
    SUBMITTED = "submitted"
    APPROVED = "approved"
    REJECTED = "rejected"
    DELETED = "deleted"


class Report(Base):
    __tablename__ = "reports"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    regiment_id: Mapped[int] = mapped_column(ForeignKey("regiments.id"))
    category_id: Mapped[int | None] = mapped_column(ForeignKey("report_categories.id"), nullable=True)
    content: Mapped[str] = mapped_column(Text)
    status: Mapped[ReportStatus] = mapped_column(
        Enum(ReportStatus, name="report_status", values_callable=lambda enum_cls: [e.value for e in enum_cls]),
        default=ReportStatus.DRAFT,
    )
    # Балл за рапорт — выставляет только полноправный командир (не заместитель)
    points: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    images: Mapped[list["ReportImage"]] = relationship(
        back_populates="report", cascade="all, delete-orphan", order_by="ReportImage.created_at"
    )
    # Автор рапорта и тот, кто последним менял статус (при status=approved — это и
    # есть одобривший) — для отображения "Докладывает" / "Рапорт одобрен" в интерфейсе
    author: Mapped["User"] = relationship(foreign_keys=[user_id])
    updated_by_user: Mapped["User | None"] = relationship(foreign_keys=[updated_by])
