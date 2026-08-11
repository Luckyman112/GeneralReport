from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.models.event import EventStatus
from app.schemas.event_activity_report import EventActivityReportRead
from app.schemas.rank import RankRead
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
    cancelled_by: UserBrief | None = None
    cancelled_at: datetime | None = None
    cancellation_reason: str | None = None


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


class EventCancelRequest(BaseModel):
    reason: str | None = None


class EventMessageRequest(BaseModel):
    """Свободное сообщение автора одобренной заявки — уходит доп. сообщением
    в тот же Discord-канал, что и карточка (см. решение пользователя)."""

    content: str = Field(min_length=1, max_length=2000)


class EventMapRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    url: str | None = None


class EventMapCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    url: str | None = Field(default=None, max_length=500)


class EventMapUpdate(BaseModel):
    """Поля, отсутствующие в теле запроса, не изменяются (exclude_unset в эндпоинте)."""

    name: str | None = Field(default=None, min_length=1, max_length=255)
    url: str | None = Field(default=None, max_length=500)


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
    rank: RankRead | None = None
    submitted_count: int
    approved_count: int
    rejected_count: int
    # Мини-ивент и Боевой вылет считаются раздельно (см. решение пользователя),
    # не одной общей цифрой
    mini_count_week: int = 0
    mini_count_month: int = 0
    mini_count_all_time: int = 0
    combat_count_week: int = 0
    combat_count_month: int = 0
    combat_count_all_time: int = 0
    activity_last_report_at: datetime | None = None


class EventMemberDetail(BaseModel):
    """Досье по одному участнику Ивентрума для клика по строке ростера (см.
    решение пользователя) — ранг + его заявки на ивенты и отчёты о
    проведённых мероприятиях, а не только агрегированные счётчики."""

    discord_id: str
    username: str
    role: str
    rank: RankRead | None = None
    events: list["EventRead"] = Field(default_factory=list)
    activity_reports: list[EventActivityReportRead] = Field(default_factory=list)
