from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Regiment(Base):
    """Боевое формирование (501, Гвардия и т.д.) — различается ролью на едином
    Discord-сервере. Права командира над формированием даёт сочетание этой роли
    с общей ролью «Командир» (settings.commander_role_id)."""

    __tablename__ = "regiments"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), unique=True)
    # Роль бойца формирования (@501)
    discord_role_id: Mapped[str] = mapped_column(String(32), unique=True)
    # Цвет формирования (hex, например "#5865f2") — влияет на цвет ника бойца и
    # акцент рапортов в интерфейсе. None — используется нейтральный цвет темы.
    color: Mapped[str | None] = mapped_column(String(7), nullable=True)
