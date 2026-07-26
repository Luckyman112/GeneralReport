from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Reprimand(Base):
    """Выговор — выдаётся командиром/заместителем своим бойцам (или высшим
    командованием/администратором кому угодно, включая командиров).

    severity: "verbal" (устный, ничего не ограничивает сам по себе) или "strict"
    (строгий, блокирует автоматическое повышение). Второй одновременно активный
    устный выговор одному и тому же бойцу автоматически создаёт дополнительный
    строгий (см. app/crud/reprimand.py::create).

    points_required — сколько баллов (за одобренные рапорты, начиная с issued_at)
    боец должен набрать, чтобы иметь право снять выговор самостоятельно (см.
    can_self_revoke). Действует бессрочно, пока не снят явно (revoked_at)."""

    __tablename__ = "reprimands"

    id: Mapped[int] = mapped_column(primary_key=True)
    target_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    regiment_id: Mapped[int] = mapped_column(ForeignKey("regiments.id"))
    reason: Mapped[str] = mapped_column(Text)
    severity: Mapped[str] = mapped_column(String(16), default="strict", server_default="strict")
    points_required: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    auto_escalated: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    issued_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    # Пояснение/апелляция бойца к своему выговору — виден тому, кто выдал, и
    # командованию формирования; правит только сам боец (см. app/api/reprimands.py)
    appeal_text: Mapped[str | None] = mapped_column(Text, nullable=True)

    target: Mapped["User"] = relationship(foreign_keys=[target_user_id])
    issuer: Mapped["User"] = relationship(foreign_keys=[issued_by])
