"""Справочник общевойсковых званий — общий для всех формирований, доступен на
чтение любому авторизованному пользователю (нужен для отображения и для выпадающего
списка в карточке участника)."""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AccessContext, get_access_context
from app.crud import rank as rank_crud
from app.database import get_db
from app.exceptions import ForbiddenError, NotFoundError
from app.schemas.promotion import TenureUpdate
from app.schemas.rank import RankRead, RankTierRead

router = APIRouter(prefix="/ranks", tags=["ranks"])


@router.get("", response_model=list[RankTierRead])
async def list_rank_tiers(
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[RankTierRead]:
    tiers = await rank_crud.get_all_tiers(db)
    return [RankTierRead.model_validate(t) for t in tiers]


@router.patch("/tiers/{tier_id}", response_model=RankTierRead)
async def update_tier_tenure(
    tier_id: int,
    payload: TenureUpdate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> RankTierRead:
    """Требование по дням выслуги для перехода в этот состав — общее на весь
    сервер, правит только высшее командование или администратор."""
    if not (access.is_admin or access.is_high_command):
        raise ForbiddenError("Изменять требования по выслуге может только высшее командование или администратор")

    tier = await rank_crud.get_tier_by_id(db, tier_id)
    if tier is None:
        raise NotFoundError("Состав не найден")

    updated = await rank_crud.update_tier_tenure(db, tier, tenure_days_required=payload.tenure_days_required)
    return RankTierRead.model_validate(updated)


@router.patch("/{rank_id}", response_model=RankRead)
async def update_rank_tenure(
    rank_id: int,
    payload: TenureUpdate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> RankRead:
    """Своё требование по дням выслуги именно для этого звания (например, "не чаще
    1 повышения в 2 дня в рядовом составе") — перекрывает требование состава. Правит
    только высшее командование или администратор."""
    if not (access.is_admin or access.is_high_command):
        raise ForbiddenError("Изменять требования по выслуге может только высшее командование или администратор")

    rank = await rank_crud.get_by_id(db, rank_id)
    if rank is None:
        raise NotFoundError("Звание не найдено")

    updated = await rank_crud.update_rank_tenure(db, rank, tenure_days_required=payload.tenure_days_required)
    return RankRead.model_validate(updated)
