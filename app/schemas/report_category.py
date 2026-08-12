from typing import Literal

from pydantic import BaseModel, ConfigDict

from app.schemas.rank import RankRead
from app.schemas.specialization import SpecializationRead
from app.schemas.squad import SquadBrief


class ReportCategoryField(BaseModel):
    # allowed_regiment_ids (roster fields only): also allow picking members from these other regiments

    name: str
    type: Literal["text", "roster"] = "text"
    allowed_regiment_ids: list[int] = []
    # roster-поля only — при открытии формы автоматически подставляет самого
    # подающего (можно сменить/убрать вручную) — см. решение пользователя
    # ("я сам" функция)
    default_self: bool = False
    # roster-поля only — разрешает вписать имя вручную текстом, если человека
    # ещё нет в составе (например только что присоединившийся рекрут) — хранится
    # в значениях поля с префиксом "manual:", см. frontend/src/components/RosterFieldPicker.jsx
    allow_manual: bool = False


class ReportCategoryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    regiment_id: int
    name: str
    fields: list[ReportCategoryField]
    points: int | None = None
    participant_points: int | None = None
    is_detention: bool = False
    is_promotion: bool = False
    is_demotion: bool = False
    is_training: bool = False
    # Не были выставлены здесь раньше — фронт (RecruitPromotionReportForm)
    # ссылался на is_recruit_promotion, но всегда получал undefined
    is_recruit_promotion: bool = False
    is_jedi_trial_report: bool = False
    is_jedi_attestation_report: bool = False
    min_rank: RankRead | None = None
    commander_only: bool = False
    required_specialization: SpecializationRead | None = None
    open_to_regiment_leadership: bool = False
    required_squad: SquadBrief | None = None
    # Совместная категория (см. Report.regiment_decisions) — каждое формирование,
    # обнаруженное среди участников, одобряет свою часть независимо
    is_joint: bool = False
    # Не более N рапортов этой категории в день на бойца — None: без лимита
    max_per_day: int | None = None


class ReportCategoryCreate(BaseModel):
    name: str
    fields: list[ReportCategoryField] = []
    points: int | None = None
    participant_points: int | None = None
    is_detention: bool = False
    min_rank_id: int | None = None
    commander_only: bool = False
    # Подать рапорт может только тот, у кого есть эта специализация (например
    # "Медицинский рапорт" -> базовый класс "Медик") — None = ограничения нет
    required_specialization_id: int | None = None
    open_to_regiment_leadership: bool = False
    # Подавать рапорт может только участник этого отряда (например "Рапорт о
    # разведке" -> отряд "Разведка") — None = ограничения нет
    required_squad_id: int | None = None
    is_joint: bool = False
    max_per_day: int | None = None


class ReportCategoryUpdate(BaseModel):
    """Поля, отсутствующие в теле запроса, не изменяются (см. exclude_unset в
    эндпоинте) — это позволяет отдельно от переименования/полей явно очистить
    points, отправив points: null."""

    name: str | None = None
    fields: list[ReportCategoryField] | None = None
    points: int | None = None
    participant_points: int | None = None
    is_detention: bool | None = None
    min_rank_id: int | None = None
    commander_only: bool | None = None
    required_specialization_id: int | None = None
    open_to_regiment_leadership: bool | None = None
    required_squad_id: int | None = None
    is_joint: bool | None = None
    max_per_day: int | None = None
