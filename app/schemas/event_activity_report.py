from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.schemas.user import UserBrief

EventActivityType = Literal["mini", "combat"]
EventActivityStatus = Literal["pending", "approved", "rejected"]


class EventActivityReportRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    event_type: EventActivityType
    payload: dict
    status: EventActivityStatus
    submitted_by: UserBrief
    created_at: datetime
    decided_by: UserBrief | None = None
    decided_at: datetime | None = None
    rejection_reason: str | None = None


class EventActivityReportCreate(BaseModel):
    event_type: EventActivityType
    payload: dict


class EventActivityReportDecide(BaseModel):
    status: Literal["approved", "rejected"]
    rejection_reason: str | None = None


class EventActivitySummaryEntry(BaseModel):
    discord_id: str
    username: str
    rank_code: str
    rank_label: str
    count_week: int
    count_month: int
    count_all_time: int
    last_report_at: datetime | None = None
