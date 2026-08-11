from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.models.admin_report import AdminReportStatus
from app.schemas.user import UserBrief

AdminReportType = Literal["activity", "punishment"]


class AdminReportRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    report_type: AdminReportType
    payload: dict
    # AdminReportStatus (реальный enum), не Literal[str,...] —
    # models.admin_report маппит status через sqlalchemy Enum, значит на
    # ORM-объекте это настоящий AdminReportStatus, а не голая строка —
    # тот же паттерн, что у ReportRead/EventBookingRead/EventRead/
    # EventActivityReportRead.status, см. app/models/event.py::EventStatus.
    status: AdminReportStatus
    submitted_by: UserBrief
    created_at: datetime
    decided_by: UserBrief | None = None
    decided_at: datetime | None = None
    rejection_reason: str | None = None


class AdminReportCreate(BaseModel):
    report_type: AdminReportType
    payload: dict


class AdminReportDecide(BaseModel):
    status: Literal["approved", "rejected"]
    rejection_reason: str | None = None


class AdminActivitySummaryEntry(BaseModel):
    discord_id: str
    username: str
    rank_code: str
    rank_label: str
    count_week: int
    count_month: int
    count_all_time: int
    last_report_at: datetime | None = None
