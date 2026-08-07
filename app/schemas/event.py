from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.models.event import EventStatus
from app.schemas.user import UserBrief


class EventRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    payload: dict[str, Any]
    status: EventStatus
    submitted_by: UserBrief
    created_at: datetime
    decided_by: UserBrief | None = None
    decided_at: datetime | None = None
    rejection_reason: str | None = None
    notified_at: datetime | None = None


class EventCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    payload: dict[str, Any] = Field(default_factory=dict)


class EventUpdate(BaseModel):
    """Правка заявки, пока она pending — например, дозаполнить командующего
    операции, которого не знали на момент подачи."""

    title: str = Field(min_length=1, max_length=255)
    payload: dict[str, Any] = Field(default_factory=dict)


class EventRejectRequest(BaseModel):
    reason: str = Field(min_length=1, max_length=2000)


class EventMapRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str


class EventMapCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
