from datetime import datetime

from pydantic import BaseModel, ConfigDict, field_validator

from app.schemas.validators import validate_service_id, validate_steam_id


class RegistrationSubmit(BaseModel):
    service_id: str
    callsign: str
    steam_id: str

    @field_validator("service_id")
    @classmethod
    def _check_service_id(cls, v: str) -> str:
        result = validate_service_id(v)
        if result is None:
            raise ValueError("ИДН обязателен")
        return result

    @field_validator("steam_id")
    @classmethod
    def _check_steam_id(cls, v: str) -> str:
        result = validate_steam_id(v)
        if result is None:
            raise ValueError("Steam ID обязателен")
        return result


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
