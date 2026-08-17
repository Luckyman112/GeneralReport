import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

from app.schemas.user import UserBrief


class GalaxyMapRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    data: dict[str, Any]
    updated_at: datetime | None = None
    updated_by_user_id: int | None = None


class GalaxyMapUpdate(BaseModel):
    data: dict[str, Any]


class GalaxyMapRequestCreate(BaseModel):
    data: dict[str, Any]
    note: str | None = None


class GalaxyMapRequestDecide(BaseModel):
    approve: bool
    rejection_reason: str | None = None


class GalaxyMapRequestRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    note: str | None = None
    status: Literal["pending", "approved", "rejected"]
    submitted_by: UserBrief
    created_at: datetime
    decided_by: UserBrief | None = None
    decided_at: datetime | None = None
    rejection_reason: str | None = None


class GalaxyMapRequestDetail(GalaxyMapRequestRead):
    data: dict[str, Any]
