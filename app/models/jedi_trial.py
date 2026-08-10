from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Integer, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.user import User


class JediTrial(Base):
    """Факт прохождения одного из пяти испытаний Падавана (см.
    app/crud/jedi_trial.py::TRIAL_GAP_DAYS для обязательного разрыва в днях
    между этапами) — кто подтвердил и когда, аналогично early_promoted_by у
    званий. Полный комплект (5 записей) требуется, чтобы сменить ранг на
    Рыцаря (см. app/api/regiments.py::_check_padawan_trials_complete)."""

    __tablename__ = "jedi_trials"
    __table_args__ = (UniqueConstraint("user_id", "trial_number", name="uq_jedi_trial_user_number"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    trial_number: Mapped[int] = mapped_column(Integer)
    passed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    passed_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))

    user: Mapped["User"] = relationship(foreign_keys=[user_id])
    passed_by: Mapped["User"] = relationship(foreign_keys=[passed_by_user_id])
