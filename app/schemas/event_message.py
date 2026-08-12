from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models.event_message import EventMessageStatus
from app.schemas.user import UserBrief


class EventMessageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    event_id: int
    content: str
    status: EventMessageStatus
    submitted_by: UserBrief
    created_at: datetime
    decided_by: UserBrief | None = None
    decided_at: datetime | None = None
    rejection_reason: str | None = None
    sent_at: datetime | None = None
    sent_by: UserBrief | None = None


class EventMessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=2000)


class EventMessageDecide(BaseModel):
    status: Literal["approved", "rejected"]
    rejection_reason: str | None = None
