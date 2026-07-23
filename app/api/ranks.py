"""Справочник общевойсковых званий — общий для всех формирований, доступен на
чтение любому авторизованному пользователю (нужен для отображения и для выпадающего
списка в карточке участника)."""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AccessContext, get_access_context
from app.crud import rank as rank_crud
from app.database import get_db
from app.schemas.rank import RankTierRead

router = APIRouter(prefix="/ranks", tags=["ranks"])


@router.get("", response_model=list[RankTierRead])
async def list_rank_tiers(
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[RankTierRead]:
    tiers = await rank_crud.get_all_tiers(db)
    return [RankTierRead.model_validate(t) for t in tiers]
