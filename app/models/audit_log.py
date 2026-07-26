from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.user import User


class AuditLog(Base):
    """Журнал действий администратора/высшего командования — кто, что и когда сделал
    в "чужой зоне" (выговор/тюнинг выслуги/профиль другого бойца/оверрайд критерия/
    решение по повышению/бэкап). Пишется только для действий из этого привилегированного
    круга, не для рутинных операций рядового состава — иначе журнал был бы бесполезен
    от объёма."""

    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    actor_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    action: Mapped[str] = mapped_column(String(64))
    details: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    actor: Mapped["User"] = relationship(foreign_keys=[actor_user_id])
