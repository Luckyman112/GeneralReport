from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    discord_id: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    username: Mapped[str] = mapped_column(String(255))
    avatar_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    # Список ID Discord-ролей пользователя в гильдии, обновляется при каждом логине
    roles: Mapped[list[str]] = mapped_column(JSON, default=list)
    # Ник, заданный командиром в веб-панели — переопределяет отображаемое имя
    # (сам Discord-ник не трогаем, это чисто отображение внутри системы)
    nickname_override: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # ИДН, звание и позывной — задаются командиром/заместителем формирования вручную,
    # используются для отображения "полного имени" в рапортах (Докладывает / Одобрил)
    service_id: Mapped[str | None] = mapped_column(String(4), nullable=True)
    callsign: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Steam ID — указывается при регистрации, чтобы командир мог найти игрока в
    # GMod/Steam (в дополнение к Discord ИДН/нику). true, если получен через
    # реальный вход Steam (OpenID, см. app/core/steam_client.py), а не введён
    # руками — тогда это SteamID64, иначе может быть старый формат STEAM_X:Y:Z
    steam_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    steam_verified: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    # overrides discord avatar in display
    photo_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    rank_id: Mapped[int | None] = mapped_column(ForeignKey("ranks.id"), nullable=True)
    # Момент назначения текущего звания — для отображения выслуги дней в нём
    rank_assigned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rank: Mapped["Rank | None"] = relationship()

    # Неактивный боец не может создавать рапорты и видит блокирующий экран вместо
    # интерфейса — переключается командиром/заместителем формирования
    is_inactive: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

    # Регистрация нового бойца: "pending" (по умолчанию для всех НОВЫХ пользователей —
    # видит форму регистрации/ожидания вместо интерфейса, не может подавать и видеть
    # рапорты), "approved" (одобрил зам+/командир его формирования — полный доступ),
    # "rejected" (отклонено — доступ закрыт, можно подать заявку заново). Уже
    # существовавшие на момент введения этой колонки пользователи имеют "approved"
    # (см. миграцию 0027) — регистрацию заново не проходят.
    registration_status: Mapped[str] = mapped_column(String(16), default="pending", server_default="pending")

    # Заполняется, когда звание меняют вручную (не через обычную заявку на
    # повышение) — командир/заместитель/админ, снимок ника + причина; очищается
    # при следующем обычном одобрении заявки (см. app/crud/promotion.py::decide)
    early_promoted_by_username: Mapped[str | None] = mapped_column(String(255), nullable=True)
    early_promotion_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # last successful web login, to spot inactive members without scanning report history
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
