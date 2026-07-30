import enum
import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, Enum, ForeignKey, Integer, String, Text, func
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
    # Звание автора НА МОМЕНТ подачи рапорта — снимок, не меняется задним числом при
    # последующих повышениях (нужно, чтобы видеть, за какое звание засчитан рапорт)
    author_rank_id: Mapped[int | None] = mapped_column(ForeignKey("ranks.id"), nullable=True)
    # Discord ID участников из ростер-полей категории (кроме автора) — используется,
    # чтобы начислить им participant_points при одобрении (см. ReportCategory)
    participant_discord_ids: Mapped[list[str]] = mapped_column(JSON, default=list, server_default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    updated_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    # Звание того, кто менял статус, НА МОМЕНТ этого действия — снимок, как и
    # author_rank_id, чтобы "Рапорт одобрен" не менялось задним числом при
    # последующих повышениях одобрившего
    updated_by_rank_id: Mapped[int | None] = mapped_column(ForeignKey("ranks.id"), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Поля нарушителя — заполняются только у рапортов категории "задержание"
    # (ReportCategory.is_detention); при одобрении такого рапорта из них автоматически
    # создаётся запись в "Нарушителях" (см. app/api/reports.py)
    target_discord_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    target_username: Mapped[str | None] = mapped_column(String(255), nullable=True)
    target_regiment_id: Mapped[int | None] = mapped_column(ForeignKey("regiments.id"), nullable=True)
    target_service_id: Mapped[str | None] = mapped_column(String(4), nullable=True)
    target_rank_id: Mapped[int | None] = mapped_column(ForeignKey("ranks.id"), nullable=True)
    target_callsign: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Наказание — тоже только для рапортов-задержаний
    punishment_type: Mapped[str | None] = mapped_column(String(16), nullable=True)
    punishment_other_text: Mapped[str | None] = mapped_column(String(255), nullable=True)
    punishment_amount: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Заполняется после того, как рапорт-задержание одобрили и создали нарушение —
    # чтобы не создать нарушение повторно при повторном одобрении
    violation_id: Mapped[int | None] = mapped_column(ForeignKey("violations.id"), nullable=True)
    # training reports only, granted to target_discord_id on approval
    training_specialization_id: Mapped[int | None] = mapped_column(ForeignKey("specializations.id"), nullable=True)

    images: Mapped[list["ReportImage"]] = relationship(
        back_populates="report", cascade="all, delete-orphan", order_by="ReportImage.created_at"
    )
    # Автор рапорта и тот, кто последним менял статус (при status=approved — это и
    # есть одобривший) — для отображения "Докладывает" / "Рапорт одобрен" в интерфейсе
    author: Mapped["User"] = relationship(foreign_keys=[user_id])
    updated_by_user: Mapped["User | None"] = relationship(foreign_keys=[updated_by])
    target_rank: Mapped["Rank | None"] = relationship(foreign_keys=[target_rank_id])
    author_rank: Mapped["Rank | None"] = relationship(foreign_keys=[author_rank_id])
    updated_by_rank: Mapped["Rank | None"] = relationship(foreign_keys=[updated_by_rank_id])
    category: Mapped["ReportCategory | None"] = relationship()
    training_specialization: Mapped["Specialization | None"] = relationship()

    @property
    def category_name(self) -> str | None:
        return self.category.name if self.category else None
