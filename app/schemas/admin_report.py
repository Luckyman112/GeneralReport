from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models.admin_report import AdminReportStatus
from app.schemas.admin_reprimand import AdminReprimandRead
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
    # Раздельно деятельность/наказания (см. решение пользователя, п.8) —
    # раньше был один общий count_*.
    activity_count_week: int
    activity_count_month: int
    activity_count_all_time: int
    punishment_count_week: int
    punishment_count_month: int
    punishment_count_all_time: int
    last_report_at: datetime | None = None
    # Активные (не снятые) выговоры — бейдж в сводке (см. решение пользователя, п.7)
    active_reprimand_count: int = 0


class AdminMemberDetail(BaseModel):
    """Досье по клику на ник в сводке активности (см. решение пользователя,
    п.6/п.8) — рапорта, раздельно деятельность/наказания, плюс
    regiment_id/regiment_name (если человек реально состоит в каком-то
    формировании) для переключателя на РП-профиль на фронте."""

    discord_id: str
    username: str
    rank_code: str
    rank_label: str
    regiment_id: int | None = None
    regiment_name: str | None = None
    activity_reports: list[AdminReportRead] = Field(default_factory=list)
    punishment_reports: list[AdminReportRead] = Field(default_factory=list)
    reprimands: list[AdminReprimandRead] = Field(default_factory=list)


class AdminActivityTrendSeries(BaseModel):
    id: str
    label: str
    points: list[int]


class AdminActivityTrendRead(BaseModel):
    """Для графика активности (TrendChart на фронте) — по дням, раздельно
    "Деятельность"/"Наказания", см. app/crud/admin_report.py::daily_type_counts."""

    dates: list[str]
    series: list[AdminActivityTrendSeries]
