from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, String, func
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
    rank_id: Mapped[int | None] = mapped_column(ForeignKey("ranks.id"), nullable=True)
    # Момент назначения текущего звания — для отображения выслуги дней в нём
    rank_assigned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rank: Mapped["Rank | None"] = relationship()

    # Неактивный боец не может создавать рапорты и видит блокирующий экран вместо
    # интерфейса — переключается командиром/заместителем формирования
    is_inactive: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
