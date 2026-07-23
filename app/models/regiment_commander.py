from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class RegimentCommander(Base):
    """Явное назначение конкретного человека командиром конкретного формирования.

    Хранится по discord_id (а не users.id), чтобы можно было назначить командиром
    того, кто ещё ни разу не логинился на сайт. Наличие записи здесь — обязательное
    условие командирских прав в дополнение к общей Discord-роли "Командир": сама по
    себе роль формирования + роль "Командир" недостаточны, если у человека одновременно
    роли нескольких формирований — иначе он стал бы командиром их всех сразу.
    """

    __tablename__ = "regiment_commanders"
    __table_args__ = (UniqueConstraint("regiment_id", "discord_id", name="uq_regiment_commander"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    regiment_id: Mapped[int] = mapped_column(ForeignKey("regiments.id"))
    discord_id: Mapped[str] = mapped_column(String(32))
    # Ник на момент назначения — для отображения без лишних обращений к Discord
    username: Mapped[str] = mapped_column(String(255))
    # "commander" — полные права (+ категории), "deputy" — только одобрение/отклонение/удаление
    role_type: Mapped[str] = mapped_column(String(16), default="commander")
