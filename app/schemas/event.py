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
    url: str | None = None
    planet_name: str | None = None
    landscape: str | None = None
    weather: str | None = None
    star_system: str | None = None


class EventMapCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    url: str | None = Field(default=None, max_length=500)
    planet_name: str | None = Field(default=None, max_length=255)
    landscape: str | None = Field(default=None, max_length=255)
    weather: str | None = Field(default=None, max_length=255)
    star_system: str | None = Field(default=None, max_length=255)


class EventMapUpdate(BaseModel):
    """Поля, отсутствующие в теле запроса, не изменяются (exclude_unset в эндпоинте)."""

    name: str | None = Field(default=None, min_length=1, max_length=255)
    url: str | None = Field(default=None, max_length=500)
    planet_name: str | None = Field(default=None, max_length=255)
    landscape: str | None = Field(default=None, max_length=255)
    weather: str | None = Field(default=None, max_length=255)
    star_system: str | None = Field(default=None, max_length=255)


class EventRosterEntry(BaseModel):
    """Строка ростера Ивентрума — участник с одной из 5 ступеней лестницы и
    статистикой и по заявкам на ивент (submitted/approved/rejected), и по
    отчётам о проведённых мероприятиях (activity_*, см.
    app/models/event_activity_report.py) — единая таблица, не две разные
    (см. решение пользователя)."""

    discord_id: str
    username: str
    avatar_url: str | None = None
    role: str  # "младший ивентолог" | "ивентолог" | "старший ивентолог" | "ассистент" | "куратор"
    submitted_count: int
    approved_count: int
    rejected_count: int
    activity_count_week: int = 0
    activity_count_month: int = 0
    activity_count_all_time: int = 0
    activity_last_report_at: datetime | None = None
