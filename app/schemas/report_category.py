from typing import Literal

from pydantic import BaseModel, ConfigDict


class ReportCategoryField(BaseModel):
    """Поле шаблона рапорта. type="text" — обычная строка; type="roster" — при
    оформлении рапорта вместо текста показывается выплывающий список состава
    формирования с возможностью отметить одного или нескольких бойцов."""

    name: str
    type: Literal["text", "roster"] = "text"


class ReportCategoryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    regiment_id: int
    name: str
    fields: list[ReportCategoryField]
    points: int | None = None


class ReportCategoryCreate(BaseModel):
    name: str
    fields: list[ReportCategoryField] = []
    points: int | None = None


class ReportCategoryUpdate(BaseModel):
    """Поля, отсутствующие в теле запроса, не изменяются (см. exclude_unset в
    эндпоинте) — это позволяет отдельно от переименования/полей явно очистить
    points, отправив points: null."""

    name: str | None = None
    fields: list[ReportCategoryField] | None = None
    points: int | None = None
