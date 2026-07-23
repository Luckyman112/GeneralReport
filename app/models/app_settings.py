from sqlalchemy import JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AppSettings(Base):
    """Singleton-таблица (всегда одна строка id=1): ID Discord-ролей админа/командира/
    заместителя (редактируются только через вход по паролю, см. app/api/app_settings.py)
    и списки формирований для модуля "Нарушители" (редактируются любым администратором,
    см. app/api/violations.py) — эти значения можно менять без правки .env и перезапуска
    сервера."""

    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    admin_role_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    commander_role_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    deputy_role_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # Формирования, чьи участники могут заводить записи о нарушениях
    violation_writer_regiment_ids: Mapped[list[int]] = mapped_column(JSON, default=list)
    # Формирования, чьи участники могут просматривать весь список нарушений (помимо
    # этого, список всегда виден любому командиру/заместителю — см. can_view_violations)
    violation_viewer_regiment_ids: Mapped[list[int]] = mapped_column(JSON, default=list)
