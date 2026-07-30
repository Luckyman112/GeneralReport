from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.rank import Rank
    from app.models.regiment import Regiment
    from app.models.user import User


class Character(Base):
    """Дополнительный игровой персонаж пользователя в ДРУГОМ формировании —
    например, джедай, приписанный сразу к двум формированиям, или второй
    игровой персонаж. Заводится и полностью настраивается только
    администратором вручную (см. app/api/characters.py) — никакой
    самостоятельной регистрации; не требует, чтобы у пользователя реально была
    Discord-роль этого формирования (карт-бланш администрации).

    Основной профиль пользователя (ИДН/звание/позывной для "первого"/обычного
    формирования) по-прежнему хранится прямо на User — эта таблица только для
    ДОПОЛНИТЕЛЬНЫХ формирований сверх основного."""

    __tablename__ = "characters"
    __table_args__ = (UniqueConstraint("user_id", "regiment_id", name="uq_character_user_regiment"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    regiment_id: Mapped[int] = mapped_column(ForeignKey("regiments.id"))
    service_id: Mapped[str | None] = mapped_column(String(4), nullable=True)
    callsign: Mapped[str | None] = mapped_column(String(255), nullable=True)
    rank_id: Mapped[int | None] = mapped_column(ForeignKey("ranks.id"), nullable=True)
    rank_assigned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Пусто — используется Steam ID пользователя (User.steam_id); задан — этот
    # персонаж играет под другим Steam-аккаунтом
    steam_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    is_inactive: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    # Джедай — носит отдельную иерархию званий (см. RankTier.is_jedi), не
    # обычную; проверяется при назначении rank_id (см. app/api/characters.py)
    is_jedi: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User"] = relationship(foreign_keys=[user_id])
    regiment: Mapped["Regiment"] = relationship(foreign_keys=[regiment_id])
    rank: Mapped["Rank | None"] = relationship(foreign_keys=[rank_id])
    created_by: Mapped["User"] = relationship(foreign_keys=[created_by_user_id])
