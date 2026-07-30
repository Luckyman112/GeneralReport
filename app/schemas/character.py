from datetime import datetime

from pydantic import BaseModel, ConfigDict, field_validator

from app.schemas.rank import RankRead
from app.schemas.regiment import RegimentRead
from app.schemas.validators import validate_service_id, validate_steam_id


class CharacterRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    regiment: RegimentRead
    service_id: str | None = None
    callsign: str | None = None
    rank: RankRead | None = None
    rank_assigned_at: datetime | None = None
    steam_id: str | None = None
    is_inactive: bool = False
    is_jedi: bool = False
    created_at: datetime


class CharacterCreate(BaseModel):
    """Администратор создаёт персонажа полностью вручную — не требует, чтобы у
    пользователя реально была Discord-роль этого формирования."""

    regiment_id: int
    service_id: str | None = None
    callsign: str | None = None
    rank_id: int | None = None
    steam_id: str | None = None
    is_jedi: bool = False

    @field_validator("service_id")
    @classmethod
    def _check_service_id(cls, v: str | None) -> str | None:
        return validate_service_id(v)

    @field_validator("steam_id")
    @classmethod
    def _check_steam_id(cls, v: str | None) -> str | None:
        return validate_steam_id(v)


class CharacterUpdate(BaseModel):
    """Поля, отсутствующие в теле запроса, не изменяются (exclude_unset в
    эндпоинте) — как и в остальных частичных обновлениях проекта."""

    service_id: str | None = None
    callsign: str | None = None
    rank_id: int | None = None
    steam_id: str | None = None
    is_inactive: bool | None = None

    @field_validator("service_id")
    @classmethod
    def _check_service_id(cls, v: str | None) -> str | None:
        return validate_service_id(v)

    @field_validator("steam_id")
    @classmethod
    def _check_steam_id(cls, v: str | None) -> str | None:
        return validate_steam_id(v)
