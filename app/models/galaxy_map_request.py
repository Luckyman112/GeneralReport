import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import JSON, DateTime, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.user import User


class GalaxyMapRequest(Base):
    """Заявка на изменение общей карты кампании (см. GalaxyMap) — Ивентолог
    любой ступени (AccessContext.is_event_submitter) не может править карту
    напрямую, только предложить полный снимок изменённых данных; Ассистент+/
    Куратор (can_decide_event) одобряет — тогда data целиком становится новым
    GalaxyMap.data — либо отклоняет. Тот же паттерн "снимок целиком, не diff",
    что и у самой карты: фронт и так уже гоняет DATA целиком (JSON-вкладка в
    drawer), отдельный diff-формат тут не нужен."""

    __tablename__ = "galaxy_map_requests"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    data: Mapped[dict] = mapped_column(JSON)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="pending", server_default="pending")
    submitted_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    decided_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    submitted_by: Mapped["User"] = relationship(foreign_keys=[submitted_by_user_id])
    decided_by: Mapped["User | None"] = relationship(foreign_keys=[decided_by_user_id])
