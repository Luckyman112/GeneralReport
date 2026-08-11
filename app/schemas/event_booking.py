from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.models.event_booking import EventBookingStatus
from app.schemas.user import UserBrief


class EventBookingRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    starts_at: datetime
    ends_at: datetime
    # EventBookingStatus (real enum), не Literal[str,...] — models.event_booking
    # maps status через sqlalchemy Enum, значит на ORM-объекте это настоящий
    # EventBookingStatus, а не голая строка; Literal["pending",...] не проходит
    # pydantic-валидацию против enum-инстанса (падает 500 при from_attributes),
    # тот же паттерн, что и у ReportRead.status/PromotionRequestRead — см.
    # app/models/report.py::ReportStatus.
    status: EventBookingStatus
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


class EventBookingCancelRequest(BaseModel):
    reason: str | None = None
