from datetime import datetime

from pydantic import BaseModel, ConfigDict


class RegistrationSubmit(BaseModel):
    service_id: str
    callsign: str
    steam_id: str


class PendingRegistrationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    discord_id: str
    username: str
    avatar_url: str | None
    service_id: str | None
    callsign: str | None
    steam_id: str | None
    created_at: datetime
    regiment_names: list[str] = []
