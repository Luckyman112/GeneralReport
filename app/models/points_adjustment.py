from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Integer, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.user import User


class PointsAdjustment(Base):
    """Ручное начисление баллов бойцу администратором/высшим командованием — в
    обход рапортов (например, за то, что не покрывается ни одной категорией).
    Учитывается в promotion_crud.sum_approved_points наравне с баллами за рапорты
    и участие; обнуляется вместе с ними при каждом повышении (see since=
    user.rank_assigned_at)."""

    __tablename__ = "points_adjustments"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    regiment_id: Mapped[int] = mapped_column(ForeignKey("regiments.id"))
    points: Mapped[int] = mapped_column(Integer)
    reason: Mapped[str] = mapped_column(Text)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User"] = relationship(foreign_keys=[user_id])
    creator: Mapped["User"] = relationship(foreign_keys=[created_by])
