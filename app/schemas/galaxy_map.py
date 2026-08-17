import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, field_validator

from app.schemas.user import UserBrief

# Карта остаётся свободным JSON-документом (см. app/api/galaxy_map.py's
# докстринг и решение пользователя — никакой полноценной схемы на месте),
# но эти пять ключей — то, от чего парсер frontend/public/galaxy-map.html
# ожидает конкретный тип (Array.isArray(...)/typeof === 'object' проверки в
# loadData()); неправильный тип здесь не сломает бэкенд, но обрушит рендер
# карты для ВСЕХ (общий singleton-документ), в т.ч. через прямой вызов API
# в обход обычного UI. Дальше внутрь (поля отдельной системы и т.д.)
# намеренно не лезем — это именно лёгкая защита от структурно неверного
# верхнего уровня, не полная валидация.
_LIST_KEYS = ("systems", "factions", "lanes", "regions", "routes", "battles", "convoys", "blockades", "log", "facilityTypes")
_DICT_KEYS = ("meta",)


def _validate_map_data(data: dict[str, Any]) -> dict[str, Any]:
    for key in _LIST_KEYS:
        if key in data and not isinstance(data[key], list):
            raise ValueError(f"data.{key} должен быть списком")
    for key in _DICT_KEYS:
        if key in data and not isinstance(data[key], dict):
            raise ValueError(f"data.{key} должен быть объектом")
    return data


class GalaxyMapRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    data: dict[str, Any]
    updated_at: datetime | None = None
    updated_by_user_id: int | None = None


class GalaxyMapUpdate(BaseModel):
    data: dict[str, Any]

    @field_validator("data")
    @classmethod
    def _check_data(cls, value: dict[str, Any]) -> dict[str, Any]:
        return _validate_map_data(value)


class GalaxyMapRequestCreate(BaseModel):
    data: dict[str, Any]
    note: str | None = None

    @field_validator("data")
    @classmethod
    def _check_data(cls, value: dict[str, Any]) -> dict[str, Any]:
        return _validate_map_data(value)


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
