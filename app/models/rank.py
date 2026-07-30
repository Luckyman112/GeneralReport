from sqlalchemy import Boolean, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class RankTier(Base):
    """Состав (группа званий) — общий для всех формирований справочник, например
    "Сержантский состав". tenure_days_required — сколько дней выслуги в предыдущем
    составе нужно, чтобы перейти в этот (None — требования нет, например для самого
    первого состава)."""

    __tablename__ = "rank_tiers"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    order: Mapped[int] = mapped_column(Integer)
    tenure_days_required: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # None = no limit, per Specialization.category
    class_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    gear_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    specialization_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    additional_specialization_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    elite_specialization_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # separate hierarchy for jedi characters, excluded from normal promotion flow
    is_jedi: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

    ranks: Mapped[list["Rank"]] = relationship(back_populates="tier", order_by="Rank.order")


class Rank(Base):
    """Конкретное звание внутри состава, например "SGT — Сержант"."""

    __tablename__ = "ranks"

    id: Mapped[int] = mapped_column(primary_key=True)
    tier_id: Mapped[int] = mapped_column(ForeignKey("rank_tiers.id"))
    code: Mapped[str] = mapped_column(String(16))
    name: Mapped[str] = mapped_column(String(255))
    order: Mapped[int] = mapped_column(Integer)
    # Своё требование по дням выслуги для перехода именно на это звание — если
    # задано, перекрывает tier.tenure_days_required для этого конкретного звания
    tenure_days_required: Mapped[int | None] = mapped_column(Integer, nullable=True)

    tier: Mapped["RankTier"] = relationship(back_populates="ranks")
