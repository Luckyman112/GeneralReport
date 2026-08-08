from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.schemas.rank import RankRead
from app.schemas.user import UserBrief

WantedResolution = Literal["detained", "arrested", "eliminated", "missing", "punished"]


class WantedEntryCreate(BaseModel):
    nickname: str
    service_id: str | None = None
    rank_id: int | None = None
    regiment_id: int | None = None
    reason: str


class WantedResolveRequest(BaseModel):
    resolution: WantedResolution


class WantedEntryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nickname: str
    service_id: str | None
    rank: RankRead | None
    regiment_id: int | None
    reason: str
    status: str
    resolution: WantedResolution | None
    author: UserBrief
    created_at: datetime
    resolved_by_user: UserBrief | None
    resolved_at: datetime | None
