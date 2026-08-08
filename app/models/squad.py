from sqlalchemy import ForeignKey, Integer, JSON, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

# Ступени внутри отряда — фиксированная структура (0..3), подписи к каждой
# ступени свои у каждого отряда (Squad.tier_labels), см. решение пользователя
# (пример: Кинолог/Старший кинолог/Заместитель отряда/Командир отряда)
SQUAD_TIER_MEMBER = 0
SQUAD_TIER_SENIOR = 1
SQUAD_TIER_DEPUTY = 2
SQUAD_TIER_COMMANDER = 3
DEFAULT_SQUAD_TIER_LABELS = ["Боец", "Старший", "Заместитель", "Командир"]


class Squad(Base):
    """Отряд — именованная подгруппа внутри формирования (например "Отряд
    разведки", "Отряд кинологов"), со своей мини-лестницей титулов. Статус
    командира/зама отряда — только отображение/ярлык в составе, никаких прав
    сверх обычного бойца формирования не даёт (см. решение пользователя).
    Рапорты по специальности отряда (например "Рапорт о разведке") — обычная
    категория формирования, никак технически не привязана к отряду."""

    __tablename__ = "squads"
    __table_args__ = (UniqueConstraint("regiment_id", "name", name="uq_squad_name_per_regiment"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    regiment_id: Mapped[int] = mapped_column(ForeignKey("regiments.id"))
    name: Mapped[str] = mapped_column(String(255))
    # Ровно 4 подписи, по одной на каждую ступень (см. SQUAD_TIER_*)
    tier_labels: Mapped[list[str]] = mapped_column(JSON, default=lambda: list(DEFAULT_SQUAD_TIER_LABELS))


class SquadMembership(Base):
    """Кто в каком отряде и на какой ступени — по discord_id (как
    RegimentCommander), чтобы можно было отметить и того, кто ещё ни разу не
    логинился на сайт."""

    __tablename__ = "squad_memberships"
    __table_args__ = (UniqueConstraint("squad_id", "discord_id", name="uq_squad_membership"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    squad_id: Mapped[int] = mapped_column(ForeignKey("squads.id"))
    discord_id: Mapped[str] = mapped_column(String(32))
    # Ник на момент назначения — для отображения без лишних обращений к Discord
    username: Mapped[str] = mapped_column(String(255))
    tier: Mapped[int] = mapped_column(Integer, default=SQUAD_TIER_MEMBER)
