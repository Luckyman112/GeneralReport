from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:
    from app.models.rank import Rank
    from app.models.regiment import Regiment
    from app.models.user import User


class TransferRequest(Base):
    """Заявка на перевод бойца из одного формирования в другое — нужны оба
    одобрения (заместитель+ формирования-источника И формирования-цели), после
    чего боец "замораживается" (не может подавать/видеть рапорты) до тех пор,
    пока в Discord у него не появится реальная роль нового формирования вместо
    старой — сайт эту роль не меняет сам, только ждёт и завершает перевод при
    следующем входе (см. app/api/auth.py::login_via_discord)."""

    __tablename__ = "transfer_requests"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    from_regiment_id: Mapped[int] = mapped_column(ForeignKey("regiments.id"))
    to_regiment_id: Mapped[int] = mapped_column(ForeignKey("regiments.id"))
    reason: Mapped[str] = mapped_column(Text)

    # pending -> approved (оба одобрения получены, боец заморожен, ждём роль)
    # -> completed (роль сменилась, звание проставлено) / rejected
    status: Mapped[str] = mapped_column(String(16), default="pending", server_default="pending")

    approved_by_source_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    approved_by_source_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_by_target_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    approved_by_target_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Звание в новом формировании — выставляет заместитель+ формирования-цели
    # в момент своего одобрения, проставляется бойцу при завершении перевода
    target_rank_id: Mapped[int | None] = mapped_column(ForeignKey("ranks.id"), nullable=True)

    rejected_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    rejected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User"] = relationship(foreign_keys=[user_id])
    from_regiment: Mapped["Regiment"] = relationship(foreign_keys=[from_regiment_id])
    to_regiment: Mapped["Regiment"] = relationship(foreign_keys=[to_regiment_id])
    target_rank: Mapped["Rank | None"] = relationship(foreign_keys=[target_rank_id])
    approved_by_source: Mapped["User | None"] = relationship(foreign_keys=[approved_by_source_id])
    approved_by_target: Mapped["User | None"] = relationship(foreign_keys=[approved_by_target_id])
    rejected_by: Mapped["User | None"] = relationship(foreign_keys=[rejected_by_id])
