from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.user import UserBrief


class AdminReprimandCreate(BaseModel):
    target_discord_id: str
    reason: str = Field(min_length=1)
    severity: Literal["verbal", "strict"] = "strict"


class AdminReprimandRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    reason: str
    severity: str
    issued_at: datetime
    revoked_at: datetime | None
    target: UserBrief
    issuer: UserBrief
