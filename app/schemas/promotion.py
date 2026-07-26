from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.schemas.rank import RankRead
from app.schemas.report import ReportRead
from app.schemas.user import UserBrief


class PromotionRequirementItem(BaseModel):
    rank_id: int
    points_required: int


class PromotionRequirementsUpdate(BaseModel):
    """Командирская надбавка сверх админской базы (см. AdminPointsUpdate)."""

    items: list[PromotionRequirementItem]


class AdminPointsItem(BaseModel):
    rank_id: int
    points_required: int


class AdminPointsUpdate(BaseModel):
    """Админская база баллов — правит только администратор/высшее командование.
    regiment_ids=None означает "применить сразу ко всем формированиям"."""

    items: list[AdminPointsItem]
    regiment_ids: list[int] | None = None


class PromotionRequirementRead(BaseModel):
    rank_id: int
    admin_points_required: int
    points_required: int
    total_points_required: int


class TenureUpdate(BaseModel):
    tenure_days_required: int | None = None


class PromotionRequestRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    regiment_id: int
    status: str
    created_at: datetime
    user: UserBrief
    from_rank: RankRead | None
    to_rank: RankRead


class CategoryRequirementStatus(BaseModel):
    requirement_id: int
    category_id: int
    category_name: str
    count_required: int
    count_current: int
    is_mandatory: bool
    satisfied: bool
    # Не None, если админ вручную переопределил результат для этого бойца
    overridden: bool = False


class PromotionStatusRead(BaseModel):
    regiment_id: int | None
    current_rank: RankRead | None
    next_rank: RankRead | None
    days_in_rank: int | None
    days_required: int | None
    points_current: int
    points_required: int
    has_active_reprimand: bool
    is_eligible: bool
    category_requirements: list[CategoryRequirementStatus] = []


class CategoryRequirementRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    regiment_id: int
    rank_id: int
    category_id: int
    count_required: int
    is_mandatory: bool
    mandatory_group_id: int | None


class LocalCategoryRequirementCreate(BaseModel):
    rank_id: int
    category_id: int
    count_required: int = 1


class MandatoryCategoryRequirementCreate(BaseModel):
    rank_id: int
    category_name: str
    # Заполняются только если категории с таким именем ещё нигде нет — тогда она
    # будет создана во всех формированиях с этим шаблоном полей
    category_fields: list[dict] = []
    count_required: int = 1


class RequirementOverrideUpdate(BaseModel):
    requirement_id: int
    target_discord_id: str
    satisfied: bool


class PromotionReviewRead(BaseModel):
    """Обзор для кнопки "Доступно повышение" в составе формирования — командир
    видит все рапорты бойца за текущее звание (с даты назначения) и выполненные
    требования по категориям для следующего звания."""

    from_rank: RankRead | None
    to_rank: RankRead
    period_start: datetime | None
    period_end: datetime
    reports: list[ReportRead] = []
    category_requirements: list[CategoryRequirementStatus] = []


class PointsAdjustmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    points: int
    reason: str
    created_at: datetime
    creator: UserBrief
