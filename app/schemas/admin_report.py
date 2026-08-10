from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.schemas.user import UserBrief

AdminReportType = Literal["activity", "punishment"]
AdminReportStatusLiteral = Literal["pending", "approved", "rejected"]


class AdminReportRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    report_type: AdminReportType
    payload: dict
    status: AdminReportStatusLiteral
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
