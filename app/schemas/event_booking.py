from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.schemas.user import UserBrief

EventBookingStatusLiteral = Literal["pending", "approved", "rejected"]


class EventBookingRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    starts_at: datetime
    ends_at: datetime
    status: EventBookingStatusLiteral
    requested_by: UserBrief
    created_at: datetime
    decided_by: UserBrief | None = None
    decided_at: datetime | None = None
    rejection_reason: str | None = None


class EventBookingCreate(BaseModel):
    title: str
    starts_at: datetime
    ends_at: datetime


class EventBookingDecide(BaseModel):
    status: Literal["approved", "rejected"]
    rejection_reason: str | None = None
