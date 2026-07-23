import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class ReportImage(Base):
    """Картинка (скриншот), прикреплённая к рапорту. Сам файл хранится на диске
    (uploads/reports/<report_id>/<filename>), здесь — только ссылка на него."""

    __tablename__ = "report_images"

    id: Mapped[int] = mapped_column(primary_key=True)
    report_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("reports.id"))
    filename: Mapped[str] = mapped_column(String(255))
    url: Mapped[str] = mapped_column(String(512))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    report: Mapped["Report"] = relationship(back_populates="images")
