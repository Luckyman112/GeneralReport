from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.models.event_activity_report import EventActivityReportStatus
from app.schemas.user import UserBrief

EventActivityType = Literal["mini", "combat"]


class EventActivityReportRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    event_type: EventActivityType
    payload: dict
    # EventActivityReportStatus (реальный enum), не Literal[str,...] —
    # models.event_activity_report маппит status через sqlalchemy Enum, значит
    # на ORM-объекте это настоящий EventActivityReportStatus, а не голая
    # строка; Literal["pending",...] не проходит pydantic-валидацию против
    # enum-инстанса (падает 500 при from_attributes) — тот же паттерн, что и
    # у ReportRead.status/EventBookingRead.status/EventRead.status, см.
    # app/models/event.py::EventStatus.
    status: EventActivityReportStatus
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


class EventActivityTrendSeries(BaseModel):
    id: str
    label: str
    points: list[int]


class EventActivityTrendRead(BaseModel):
    """Для графика активности (TrendChart на фронте) — по дням, раздельно
    Мини-ивент/Боевой вылет, см. app/crud/event_activity_report.py::daily_type_counts."""

    dates: list[str]
    series: list[EventActivityTrendSeries]
