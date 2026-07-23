from pydantic import BaseModel, ConfigDict


class RankRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    tier_id: int
    code: str
    name: str
    order: int


class RankTierRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    order: int
    tenure_days_required: int | None
    ranks: list[RankRead]
