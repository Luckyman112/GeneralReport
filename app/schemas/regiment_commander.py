from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, field_validator

from app.schemas.rank import RankRead
from app.schemas.validators import validate_service_id, validate_steam_id


class RegimentCommanderRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    discord_id: str
    username: str
    role_type: Literal["commander", "deputy", "mentor"]


class RegimentCommanderCreate(BaseModel):
    discord_id: str
    username: str
    role_type: Literal["commander", "deputy", "mentor"] = "commander"


class GuildMemberRead(BaseModel):
    discord_id: str
    username: str
    # Настоящий Discord-ник участника (без веб-переопределения) — чтобы можно было
    # найти человека в Discord, даже если в системе у него задан другой веб-ник
    discord_username: str
    avatar_url: str | None = None
    # Только для /commander-candidates — какая из "командирских" Discord-ролей есть
    # у этого участника, чтобы веб-панель могла предложить нужный role_type по умолчанию
    is_commander_role: bool = False
    is_deputy_role: bool = False
    # Профиль для полного имени в рапортах (ИДН + звание + позывной) — задаётся
    # командиром/заместителем формирования
    service_id: str | None = None
    callsign: str | None = None
    # Steam ID — указан при регистрации, чтобы найти игрока в GMod/Steam
    steam_id: str | None = None
    # overrides discord avatar_url if set
    photo_url: str | None = None
    rank: RankRead | None = None
    # Сколько дней участник в текущем звании — для сверки с требованием по выслуге
    days_in_rank: int | None = None
    is_inactive: bool = False
    early_promoted_by_username: str | None = None
    early_promotion_reason: str | None = None
    last_login_at: datetime | None = None
    # first web login, approximates join date (no exact discord-role-grant tracking)
    joined_at: datetime | None = None
    rank_assigned_at: datetime | None = None


class MemberProfileUpdate(BaseModel):
    """Единая форма профиля участника (ИДН + звание + позывной + отметка
    неактивности). Поля, отсутствующие в теле запроса, не изменяются (exclude_unset
    в эндпоинте) — так же, как в ReportCategoryUpdate, это позволяет явно очищать
    поле, отправив null, не трогая остальные.

    Отдельного поля "веб-ник" больше нет — позывной и есть веб-ник (см. комментарий
    в app/api/regiments.py::update_member_profile)."""

    service_id: str | None = None
    callsign: str | None = None
    steam_id: str | None = None
    rank_id: int | None = None
    is_inactive: bool | None = None
    # Причина досрочного повышения — учитывается, только если rank_id реально
    # меняется (см. app/api/regiments.py::update_member_profile)
    early_promotion_reason: str | None = None

    @field_validator("service_id")
    @classmethod
    def _check_service_id(cls, v: str | None) -> str | None:
        return validate_service_id(v)

    @field_validator("steam_id")
    @classmethod
    def _check_steam_id(cls, v: str | None) -> str | None:
        return validate_steam_id(v)


class TenureOverrideUpdate(BaseModel):
    """Админ-панель: принудительно выставить, сколько дней участник уже "провёл"
    в текущем звании (перематывает rank_assigned_at назад на это число дней от
    текущего момента) — используется, чтобы вручную скорректировать выслугу."""

    days_in_rank: int


class PointsAdjustmentBody(BaseModel):
    """Админ-панель: ручное начисление баллов бойцу в обход рапортов."""

    points: int
    reason: str
