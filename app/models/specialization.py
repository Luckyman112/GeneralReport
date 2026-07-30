from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import Date, DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.rank import Rank
    from app.models.user import User


CATEGORY_CLASS = "class"
CATEGORY_GEAR = "gear"
CATEGORY_SPECIALIZATION = "specialization"
CATEGORY_ADDITIONAL_SPECIALIZATION = "additional_specialization"
CATEGORY_ELITE_SPECIALIZATION = "elite_specialization"
SPECIALIZATION_CATEGORIES = [
    CATEGORY_CLASS,
    CATEGORY_GEAR,
    CATEGORY_SPECIALIZATION,
    CATEGORY_ADDITIONAL_SPECIALIZATION,
    CATEGORY_ELITE_SPECIALIZATION,
]
# Специализация с этим кодом освобождает бойца от всех лимитов на обучение по
# составу (см. вики: "ЭРК [ARC] - Без ограничений")
UNLIMITED_TRAINING_CODE = "ARC"


class Specialization(Base):
    """Каталог специализаций/классов/снаряжения ВАР (Медик, Инженер, Штурмовик и
    т.д.) — общий для всех формирований, ведётся администратором. Выдаётся бойцу
    вручную инструктором (см. UserSpecialization), а не через рапорты/повышения.

    category — тип, по которому считаются лимиты на обучение по составу (см.
    RankTier.*_limit): "class" (общий класс), "gear" (общее снаряжение),
    "specialization" (общая специализация), "additional_specialization"
    (дополнительная специализация), "elite_specialization" (элитная)."""

    __tablename__ = "specializations"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(16), unique=True)
    name: Mapped[str] = mapped_column(String(255))
    category: Mapped[str] = mapped_column(String(32), default=CATEGORY_SPECIALIZATION, server_default=CATEGORY_SPECIALIZATION)
    # Минимальное звание, необходимое бойцу, чтобы обучиться этой специализации
    # (см. вики: "Обучение доступно со звания PVT+") — None означает, что
    # минимального звания нет (ограничивают только лимиты по составу)
    min_rank_id: Mapped[int | None] = mapped_column(ForeignKey("ranks.id"), nullable=True)
    min_rank: Mapped["Rank | None"] = relationship()


class UserSpecialization(Base):
    """Факт выдачи конкретной специализации конкретному бойцу — кто выдал и когда,
    чтобы это было видно в личном деле (аналогично early_promoted_by у званий)."""

    __tablename__ = "user_specializations"
    __table_args__ = (UniqueConstraint("user_id", "specialization_id", name="uq_user_specialization"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    specialization_id: Mapped[int] = mapped_column(ForeignKey("specializations.id"))
    granted_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    granted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User"] = relationship(foreign_keys=[user_id])
    specialization: Mapped["Specialization"] = relationship()
    granted_by: Mapped["User"] = relationship(foreign_keys=[granted_by_user_id])


class SpecializationBan(Base):
    """Запрет бойцу на обучение — на конкретную специализацию (specialization_id
    задан) или на любое обучение вообще (specialization_id NULL). until_date —
    до указанной даты включительно; None означает бессрочный (постоянный)
    запрет. Показывается в личном деле пометкой вида "[PIL] до 13.10" (или
    "[PIL] навсегда" для бессрочного), как описано в вики."""

    __tablename__ = "specialization_bans"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    specialization_id: Mapped[int | None] = mapped_column(ForeignKey("specializations.id"), nullable=True)
    until_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User"] = relationship(foreign_keys=[user_id])
    specialization: Mapped["Specialization | None"] = relationship()
    created_by: Mapped["User"] = relationship(foreign_keys=[created_by_user_id])
