from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.schemas.rank import RankRead


class ReportCategoryField(BaseModel):
    # allowed_regiment_ids (roster fields only): also allow picking members from these other regiments

    name: str
    type: Literal["text", "roster"] = "text"
    allowed_regiment_ids: list[int] = []


class ReportCategoryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    regiment_id: int
    name: str
    fields: list[ReportCategoryField]
    points: int | None = None
    participant_points: int | None = None
    is_detention: bool = False
    is_promotion: bool = False
    is_demotion: bool = False
    is_training: bool = False
    min_rank: RankRead | None = None
    commander_only: bool = False


class ReportCategoryCreate(BaseModel):
    name: str
    fields: list[ReportCategoryField] = []
    points: int | None = None
    participant_points: int | None = None
    is_detention: bool = False
    min_rank_id: int | None = None
    commander_only: bool = False


class ReportCategoryUpdate(BaseModel):
    """Поля, отсутствующие в теле запроса, не изменяются (см. exclude_unset в
    эндпоинте) — это позволяет отдельно от переименования/полей явно очистить
    points, отправив points: null."""

    name: str | None = None
    fields: list[ReportCategoryField] | None = None
    points: int | None = None
    participant_points: int | None = None
    is_detention: bool | None = None
    min_rank_id: int | None = None
    commander_only: bool | None = None
