from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class GalaxyMap(Base):
    """Singleton-таблица (всегда одна строка id=1) — общая карта кампании,
    видна всем (см. app/api/deps.py::AccessContext.has_access), напрямую
    редактируется только Ассистентом+/Куратором Ивентологии
    (AccessContext.can_decide_event), см. app/api/galaxy_map.py. data — весь
    JSON-блок карты (системы/фракции/бои/журнал/т.д.) ровно в том виде, в
    котором его строит фронтовый galaxy-map.html — тут нет отдельных колонок
    под каждое поле, весь предыдущий localStorage-формат просто переехал сюда
    целиком."""

    __tablename__ = "galaxy_map"

    id: Mapped[int] = mapped_column(primary_key=True)
    data: Mapped[dict] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
