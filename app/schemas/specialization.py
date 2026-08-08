from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.rank import RankRead
from app.schemas.user import UserBrief

SpecializationCategory = Literal[
    "class",
    "gear",
    "specialization",
    "additional_specialization",
    "elite_specialization",
    "medic",
    "pilot",
    "engineer",
]


class SpecializationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str
    category: SpecializationCategory
    min_rank: RankRead | None = None
    required_regiment_id: int | None = None
    parent_id: int | None = None


class SpecializationCreate(BaseModel):
    code: str = Field(min_length=1, max_length=16)
    name: str = Field(min_length=1, max_length=255)
    category: SpecializationCategory = "specialization"
    min_rank_id: int | None = None
    # Редкое доп. требование — обучение доступно только бойцам этого формирования
    required_regiment_id: int | None = None
    # Подспециализация — выдать её можно только тем, у кого уже есть родительская
    parent_id: int | None = None


class SpecializationUpdate(BaseModel):
    """Поля, отсутствующие в теле запроса, не изменяются (см. exclude_unset в
    эндпоинте) — так же, как в остальных частичных обновлениях проекта, это
    позволяет явно очистить min_rank_id/required_regiment_id/parent_id, отправив
    null, не трогая остальное."""

    code: str | None = Field(default=None, min_length=1, max_length=16)
    name: str | None = Field(default=None, min_length=1, max_length=255)
    category: SpecializationCategory | None = None
    min_rank_id: int | None = None
    required_regiment_id: int | None = None
    parent_id: int | None = None


class UserSpecializationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    specialization: SpecializationRead
    granted_by: UserBrief
    granted_at: datetime


class GrantSpecializationRequest(BaseModel):
    specialization_id: int


class DisciplineRosterEntry(BaseModel):
    """Строка кросс-формационного ростера дисциплины — боец + его специализация
    этой ветки + формирование(-я), где он состоит (по Discord-ролям)."""

    model_config = ConfigDict(from_attributes=True)

    user: UserBrief
    specialization: SpecializationRead
    granted_at: datetime
    regiment_names: list[str] = []
    # Инструкторский тир бойца В ЭТОЙ дисциплине (curator/deputy/instructor),
    # None — просто держит специализацию, без инструкторской роли (см. решение
    # пользователя — ростер показывает иерархию: куратор/зам/инструктор сверху,
    # остальные ниже)
    tier: str | None = None


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


InstructorDiscipline = Literal["medic", "pilot", "engineer"]


InstructorTier = Literal["instructor", "deputy", "curator"]


class InstructorRoleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    discord_role_id: str
    label: str
    discipline: InstructorDiscipline | None
    can_teach_all: bool
    tier: InstructorTier = "instructor"


class InstructorRoleCreate(BaseModel):
    discord_role_id: str = Field(min_length=1, max_length=32)
    label: str = Field(min_length=1, max_length=255)
    # ровно одно из двух: либо конкретная дисциплина, либо "может учить всему"
    discipline: InstructorDiscipline | None = None
    can_teach_all: bool = False
    # instructor (обычный) / deputy (DEP) / curator (CU) — иерархия внутри
    # дисциплины, см. INSTRUCTOR_TIERS
    tier: InstructorTier = "instructor"
