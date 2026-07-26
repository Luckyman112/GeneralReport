from pydantic import BaseModel


class StatBucket(BaseModel):
    id: int | None
    label: str
    count: int
    # Заполнено только для by_person — чтобы фронт мог открыть рапорты этого
    # человека через уже существующий /regiments/{id}/members/{discord_id}/reports
    discord_id: str | None = None
    # Заполнено только для by_regiment — цвет формирования (Regiment.color), чтобы
    # диаграмма сравнения формирований красилась их собственными цветами, а не
    # обезличенной категориальной палитрой
    color: str | None = None


class RegimentStatsRead(BaseModel):
    by_person: list[StatBucket]
    by_category: list[StatBucket]


class TrendSeries(BaseModel):
    id: int
    label: str
    color: str | None = None
    points: list[int]


class FormationStatsRead(BaseModel):
    by_regiment: list[StatBucket]
    trend_dates: list[str] = []
    trend: list[TrendSeries] = []
