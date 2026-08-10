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


class SquadBadge(BaseModel):
    squad_name: str
    tier_label: str
    # SQUAD_TIER_* (app/models/squad.py) — tier_label — произвольный текст на
    # усмотрение командира, по нему нельзя понять, командир это отряда или нет
    tier: int


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
    # Джедайское командное звание (CO/SCO/GEN/SGEN/HGEN) — независимо от rank_id
    # (личного ранга джедая), см. app/models/user.py::jedi_title_id
    jedi_title: RankRead | None = None
    # Совет Ордена — чистый титул, см. app/models/user.py::JEDI_COUNCIL_SEATS
    jedi_council_seat: str | None = None
    # Сколько дней участник в текущем звании — для сверки с требованием по выслуге
    days_in_rank: int | None = None
    is_inactive: bool = False
    early_promoted_by_username: str | None = None
    early_promotion_reason: str | None = None
    last_login_at: datetime | None = None
    # first web login, approximates join date (no exact discord-role-grant tracking)
    joined_at: datetime | None = None
    rank_assigned_at: datetime | None = None
    # None — вообще нет записи в БД (ни разу не заходил), "pending"/"rejected" —
    # заходил, но не прошёл регистрацию/был отклонён (см. решение пользователя —
    # такие участники должны быть заметны прямо в составе формирования)
    registration_status: str | None = None
    # Отряды — только ярлык в составе, см. app/models/squad.py
    squads: list[SquadBadge] = []
    # Дата последнего рапорта (любого статуса кроме удалённого) — колонка
    # "активности" в составе, см. report_crud.last_report_at_by_user_ids
    last_report_at: datetime | None = None


class DiscordChannelRead(BaseModel):
    id: str
    name: str


class HqPersonRead(BaseModel):
    """Тот же набор полей, что у UserBrief (для formatFullName на фронте — ИДН |
    звание | позывной, как везде, см. решение пользователя) — своя схема, а не
    прямой алиас UserBrief, потому что человек может не иметь записи в БД
    (ни разу не логинился) — тогда только discord_id/username из Discord."""

    discord_id: str
    username: str
    nickname_override: str | None = None
    service_id: str | None = None
    callsign: str | None = None
    rank: RankRead | None = None
    avatar_url: str | None = None


class HqCommanderRead(BaseModel):
    role_type: Literal["commander", "deputy", "mentor"]
    person: HqPersonRead


class HqFormationLeadershipRead(BaseModel):
    regiment_id: int
    regiment_name: str
    regiment_color: str | None = None
    commanders: list[HqCommanderRead]


class HqLeadershipRead(BaseModel):
    """Статичный список командования всех формирований для страницы Штаба (см.
    решение пользователя) — высшее командование отдельным блоком сверху, ниже
    формирования каждое со своими командиром/замами (регистрируются в
    Формирования -> Настроить; см. RegimentCommander)."""

    high_command: list[HqPersonRead]
    formations: list[HqFormationLeadershipRead]


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
    # Джедайское командное звание — отдельно от rank_id (личного ранга), меняет
    # только admin/high_command (см. app/api/regiments.py::update_member_profile)
    jedi_title_id: int | None = None
    # Совет Ордена — чистый титул, одно из JEDI_COUNCIL_SEATS, меняет только
    # admin/high_command (см. app/models/user.py::jedi_council_seat)
    jedi_council_seat: str | None = None
    is_inactive: bool | None = None
    # Причина досрочного повышения — учитывается, если rank_id или jedi_title_id
    # реально меняются (см. app/api/regiments.py::update_member_profile)
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
