from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.schemas.rank import RankRead


class RegimentCommanderRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    discord_id: str
    username: str
    role_type: Literal["commander", "deputy"]


class RegimentCommanderCreate(BaseModel):
    discord_id: str
    username: str
    role_type: Literal["commander", "deputy"] = "commander"


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
    rank: RankRead | None = None
    # Сколько дней участник в текущем звании — для сверки с требованием по выслуге
    days_in_rank: int | None = None
    is_inactive: bool = False


class MemberProfileUpdate(BaseModel):
    """Единая форма профиля участника (веб-ник + ИДН + звание + позывной + отметка
    неактивности). Поля, отсутствующие в теле запроса, не изменяются (exclude_unset
    в эндпоинте) — так же, как в ReportCategoryUpdate, это позволяет явно очищать
    поле, отправив null, не трогая остальные."""

    nickname: str | None = None
    service_id: str | None = None
    callsign: str | None = None
    rank_id: int | None = None
    is_inactive: bool | None = None
