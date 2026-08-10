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
    # Лимиты по дисциплинам (подспециализации внутри Медика/Пилота/Инженера —
    # см. Specialization.parent_id/DISCIPLINE_CATEGORIES). Обычно 1, но для
    # некоторых составов может быть больше (боец с двумя медицинскими
    # подспециализациями сразу)
    medic_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    pilot_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)
    engineer_limit: Mapped[int | None] = mapped_column(Integer, nullable=True)

    # separate hierarchy for jedi characters, excluded from normal promotion flow
    is_jedi: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    # Within is_jedi tiers: true only for the "ранг" ladder (Падаван/Рыцарь/
    # Мастер/Гранд-Мастер) — these DO participate in the normal auto-promotion
    # pipeline (tenure/points), unlike "звание" tiers (CO/SCO/GEN/SGEN/HGEN,
    # is_jedi=true, is_jedi_rank_track=false), which stay fully manual as before.
    # See app/crud/rank.py::get_next_rank.
    is_jedi_rank_track: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

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

    # Джедайский ранг только: true исключает переход СЮДА из авто-промо-пайплайна
    # (сейчас только Гранд-Мастер — переход только вручную, admin/high_command,
    # см. app/api/regiments.py). См. app/crud/rank.py::get_next_rank.
    jedi_manual_only: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    # Джедайский ранг только: максимально допустимое звание (id другого Rank,
    # из is_jedi=true/is_jedi_rank_track=false тира) при этом ранге — потолок,
    # не корреляция. См. app/api/regiments.py::_check_jedi_title_ceiling.
    max_jedi_title_rank_id: Mapped[int | None] = mapped_column(ForeignKey("ranks.id"), nullable=True)
