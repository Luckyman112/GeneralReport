from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class AdminReprimand(Base):
    """Выговор Администрации — параллельная app/models/reprimand.py::Reprimand
    (РП-формирования) сущность, а не переиспользование её: Reprimand жёстко
    завязан на regiment_id (non-nullable FK) и на RegimentCommander-права, а
    Администрация не привязана к формированию (см. решение пользователя).
    Без auto-эскалации/points_required — та механика опиралась на баллы за
    рапорты конкретного формирования, тут такого понятия нет; просто ручной
    выговор с severity, выдаёт/снимает access.can_decide_admin_report (тот же
    гейт, что решает отчёты — старший состав Администрации)."""

    __tablename__ = "admin_reprimands"

    id: Mapped[int] = mapped_column(primary_key=True)
    target_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    reason: Mapped[str] = mapped_column(Text)
    severity: Mapped[str] = mapped_column(String(16), default="strict", server_default="strict")
    issued_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    target: Mapped["User"] = relationship(foreign_keys=[target_user_id])
    issuer: Mapped["User"] = relationship(foreign_keys=[issued_by_user_id])
