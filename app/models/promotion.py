from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.rank import Rank
    from app.models.report_category import ReportCategory
    from app.models.user import User


class PromotionRequirement(Base):
    """Требование по баллам для перехода на конкретное звание — состоит из двух
    независимых частей, которые складываются: admin_points_required — база, которую
    заводит администратор/высшее командование (можно применить сразу ко всем
    формированиям), её командир менять не может; points_required — то, что сверх
    базы докидывает от себя полноправный командир формирования (может оставить 0).
    Итоговое требование = admin_points_required + points_required. Требование по
    дням выслуги общее на весь сервер — RankTier.tenure_days_required или
    Rank.tenure_days_required (если задано для конкретного звания), правит только
    администратор/высшее командование."""

    __tablename__ = "promotion_requirements"
    __table_args__ = (UniqueConstraint("regiment_id", "rank_id", name="uq_promotion_requirement"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    regiment_id: Mapped[int] = mapped_column(ForeignKey("regiments.id"))
    rank_id: Mapped[int] = mapped_column(ForeignKey("ranks.id"))
    # Докидывает командир формирования сверх админской базы
    points_required: Mapped[int] = mapped_column(Integer, default=0)
    # База, которую задаёт администратор/высшее командование — командиру недоступна
    admin_points_required: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


class PromotionCategoryRequirement(Base):
    """Требование "нужно N одобренных рапортов категории X" для перехода на звание.

    is_mandatory=True — заведено администратором как обязательное для ВСЕХ
    формирований (категория при этом клонируется в каждое формирование, см.
    app/api/promotions.py); командир такое требование видит, но не может убрать —
    только редактировать count_required не может тоже, это исключительно админская
    зона. is_mandatory=False — обычное требование, которое командир формирования
    сам заводит на основе категорий, существующих в его формировании."""

    __tablename__ = "promotion_category_requirements"
    __table_args__ = (
        UniqueConstraint("regiment_id", "rank_id", "category_id", name="uq_promotion_category_requirement"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    regiment_id: Mapped[int] = mapped_column(ForeignKey("regiments.id"))
    rank_id: Mapped[int] = mapped_column(ForeignKey("ranks.id"))
    category_id: Mapped[int] = mapped_column(ForeignKey("report_categories.id"))
    count_required: Mapped[int] = mapped_column(Integer, default=1)
    is_mandatory: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    # Заполнено только у is_mandatory=True — чтобы при удалении одним действием
    # снять клонированное требование во всех формированиях разом
    mandatory_group_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    category: Mapped["ReportCategory"] = relationship()


class PromotionRequirementOverride(Base):
    """Ручное переопределение админом: считать ли конкретное категорийное
    требование выполненным для конкретного бойца, независимо от реального
    подсчёта одобренных рапортов."""

    __tablename__ = "promotion_requirement_overrides"
    __table_args__ = (UniqueConstraint("user_id", "requirement_id", name="uq_promotion_requirement_override"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    requirement_id: Mapped[int] = mapped_column(ForeignKey("promotion_category_requirements.id"))
    satisfied: Mapped[bool] = mapped_column(Boolean)
    set_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    set_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PromotionRequest(Base):
    """Заявка на повышение — создаётся автоматически, когда боец выполнил все
    критерии (баллы + дни выслуги) и не имеет непогашенного выговора. Одобрить может
    заместитель/командир/высшее командование/админ этого формирования."""

    __tablename__ = "promotion_requests"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    regiment_id: Mapped[int] = mapped_column(ForeignKey("regiments.id"))
    from_rank_id: Mapped[int | None] = mapped_column(ForeignKey("ranks.id"), nullable=True)
    to_rank_id: Mapped[int] = mapped_column(ForeignKey("ranks.id"))
    status: Mapped[str] = mapped_column(String(16), default="pending")
    # Снимок user.rank_assigned_at на момент создания заявки — сохраняет начало
    # периода "за это звание" даже после того, как повышение состоится и
    # rank_assigned_at перезапишется новой датой (нужно для истории/обзора)
    tenure_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    decided_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped["User"] = relationship(foreign_keys=[user_id])
    from_rank: Mapped["Rank | None"] = relationship(foreign_keys=[from_rank_id])
    to_rank: Mapped["Rank"] = relationship(foreign_keys=[to_rank_id])
