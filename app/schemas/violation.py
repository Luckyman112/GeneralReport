from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.rank import RankRead
from app.schemas.user import UserBrief


class ViolationCreate(BaseModel):
    """Нарушитель либо выбирается из состава Discord-сервера (target_discord_id),
    либо — если его там нет — вводится вручную (target_service_id + target_rank_id +
    target_regiment_id + target_callsign, все четыре обязательны вместе)."""

    target_discord_id: str | None = None
    target_service_id: str | None = None
    target_rank_id: int | None = None
    target_regiment_id: int | None = None
    target_callsign: str | None = None
    description: str = Field(min_length=1)


class ViolationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    target_discord_id: str | None
    target_username: str | None
    target_regiment_id: int | None
    target_service_id: str | None
    target_callsign: str | None
    target_rank: RankRead | None
    description: str
    created_at: datetime
    author: UserBrief


class ViolationSettingsRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    violation_writer_regiment_ids: list[int]
    violation_viewer_regiment_ids: list[int]


class ViolationSettingsUpdate(BaseModel):
    """Поля, отсутствующие в теле запроса, не изменяются (exclude_unset в эндпоинте)."""

    writer_regiment_ids: list[int] | None = None
    viewer_regiment_ids: list[int] | None = None
