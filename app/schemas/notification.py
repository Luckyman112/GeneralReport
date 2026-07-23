from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class NotificationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: Literal["broadcast", "violation"]
    title: str
    body: str
    regiment_id: int | None
    violation_id: int | None
    created_at: datetime
    is_read: bool = False


class BroadcastCreate(BaseModel):
    title: str = Field(min_length=1)
    body: str = Field(min_length=1)
