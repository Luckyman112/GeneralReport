import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models.report import ReportStatus
from app.schemas.rank import RankRead
from app.schemas.report_image import ReportImageRead
from app.schemas.user import UserBrief

PunishmentType = Literal["verbal", "skt", "detention", "other"]


class ReportCreate(BaseModel):
    regiment_id: int
    category_id: int | None = None
    content: str = Field(min_length=1)
    # Если True — рапорт сразу отправляется (submitted), иначе сохраняется как черновик
    submit: bool = False

    # Заполняются только для рапортов категории "задержание" (ReportCategory.is_detention).
    # Формирование задержанного указывается явно всегда; нарушитель либо выбирается из
    # состава Discord-сервера (target_discord_id), либо — если его там нет — вводится
    # вручную (ИДН + звание + позывной)
    target_discord_id: str | None = None
    target_service_id: str | None = None
    target_rank_id: int | None = None
    target_regiment_id: int | None = None
    target_callsign: str | None = None
    punishment_type: PunishmentType | None = None
    punishment_other_text: str | None = None
    punishment_amount: str | None = None
    # Discord ID участников из ростер-полей категории (кроме автора) — получат
    # ReportCategory.participant_points при одобрении
    participant_discord_ids: list[str] = []


class ReportStatusUpdate(BaseModel):
    """Изменение статуса рапорта командиром (одобрить/отклонить/удалить)."""

    status: ReportStatus
    rejection_reason: str | None = None


class ReportPointsUpdate(BaseModel):
    """Балл за рапорт — выставляет только полноправный командир."""

    points: int


class ReportRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: int
    regiment_id: int
    category_id: int | None
    content: str
    status: ReportStatus
    points: int | None
    images: list[ReportImageRead]
    created_at: datetime
    updated_at: datetime
    updated_by: int | None
    deleted_at: datetime | None
    rejection_reason: str | None
    author: UserBrief
    # Звание автора на момент подачи рапорта (снимок, не меняется задним числом)
    author_rank: RankRead | None = None
    # Кто последним менял статус — "Рапорт одобрен: ..." имеет смысл показывать
    # только когда status == approved (проверяется на фронте по report.status)
    updated_by_user: UserBrief | None
    # Звание того, кто менял статус, НА МОМЕНТ этого действия (снимок, как и author_rank)
    updated_by_rank: RankRead | None = None

    target_discord_id: str | None = None
    target_username: str | None = None
    target_regiment_id: int | None = None
    target_service_id: str | None = None
    target_callsign: str | None = None
    target_rank: RankRead | None = None
    punishment_type: str | None = None
    punishment_other_text: str | None = None
    punishment_amount: str | None = None
    violation_id: int | None = None
