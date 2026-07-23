from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.user import UserBrief


class ViolationCreate(BaseModel):
    target_discord_id: str
    description: str = Field(min_length=1)


class ViolationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    target_discord_id: str
    target_username: str
    target_regiment_id: int | None
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
