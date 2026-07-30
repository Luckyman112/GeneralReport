from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.rank import RankRead
from app.schemas.user import UserBrief

SpecializationCategory = Literal[
    "class", "gear", "specialization", "additional_specialization", "elite_specialization"
]


class SpecializationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str
    category: SpecializationCategory
    min_rank: RankRead | None = None


class SpecializationCreate(BaseModel):
    code: str = Field(min_length=1, max_length=16)
    name: str = Field(min_length=1, max_length=255)
    category: SpecializationCategory = "specialization"
    min_rank_id: int | None = None


class SpecializationUpdate(BaseModel):
    """Поля, отсутствующие в теле запроса, не изменяются (см. exclude_unset в
    эндпоинте) — так же, как в остальных частичных обновлениях проекта, это
    позволяет явно очистить min_rank_id, отправив null, не трогая остальное."""

    code: str | None = Field(default=None, min_length=1, max_length=16)
    name: str | None = Field(default=None, min_length=1, max_length=255)
    category: SpecializationCategory | None = None
    min_rank_id: int | None = None


class UserSpecializationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    specialization: SpecializationRead
    granted_by: UserBrief
    granted_at: datetime


class GrantSpecializationRequest(BaseModel):
    specialization_id: int


class SpecializationBanRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    specialization: SpecializationRead | None
    # None — бессрочный (постоянный) запрет
    until_date: date | None
    reason: str | None
    created_by: UserBrief
    created_at: datetime


class SpecializationBanWithUserRead(SpecializationBanRead):
    """То же самое, но со сводным списком по всем бойцам сразу — нужно указать,
    чей это запрет (см. GET /specialization-bans/active)."""

    user: UserBrief


class SpecializationBanCreate(BaseModel):
    # None — запрет на любое обучение вообще, не только на одну специализацию
    specialization_id: int | None = None
    # None — бессрочный (постоянный) запрет, не только временный
    until_date: date | None = None
    reason: str | None = None


class InstructorActivityRead(BaseModel):
    instructor: UserBrief
    grants_count: int
