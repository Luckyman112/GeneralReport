from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.schemas.rank import RankRead


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    discord_id: str
    username: str
    avatar_url: str | None
    is_inactive: bool
    registration_status: str
    service_id: str | None
    callsign: str | None
    steam_id: str | None
    steam_verified: bool = False
    created_at: datetime


class UserBrief(BaseModel):
    """Краткие данные автора/изменившего рапорт — для отображения "Докладывает" /
    "Рапорт одобрен" (полное имя ИДН+звание+позывной собирается на фронте)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    discord_id: str
    username: str
    nickname_override: str | None
    service_id: str | None
    callsign: str | None
    rank: RankRead | None
