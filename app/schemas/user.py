from datetime import datetime

from pydantic import BaseModel, ConfigDict


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    discord_id: str
    username: str
    avatar_url: str | None
    created_at: datetime
