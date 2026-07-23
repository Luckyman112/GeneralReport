from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class AppSettings(Base):
    """Singleton-таблица (всегда одна строка id=1): ID Discord-ролей админа/командира/
    заместителя. Редактируется только через вход по паролю (см. app/api/app_settings.py),
    поэтому эти значения можно менять без правки .env и перезапуска сервера."""

    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    admin_role_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    commander_role_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    deputy_role_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
