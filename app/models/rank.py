from sqlalchemy import ForeignKey, Integer, String
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

    ranks: Mapped[list["Rank"]] = relationship(back_populates="tier", order_by="Rank.order")


class Rank(Base):
    """Конкретное звание внутри состава, например "SGT — Сержант"."""

    __tablename__ = "ranks"

    id: Mapped[int] = mapped_column(primary_key=True)
    tier_id: Mapped[int] = mapped_column(ForeignKey("rank_tiers.id"))
    code: Mapped[str] = mapped_column(String(16))
    name: Mapped[str] = mapped_column(String(255))
    order: Mapped[int] = mapped_column(Integer)

    tier: Mapped["RankTier"] = relationship(back_populates="ranks")
