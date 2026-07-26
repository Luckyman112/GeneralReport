"""Статистика по рапортам: кто сколько подал (для страницы "Главное") и сравнение
активности формирований (только администратор/высшее командование)."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AccessContext, get_access_context
from app.crud import regiment as regiment_crud
from app.crud import stats as stats_crud
from app.crud import user as user_crud
from app.database import get_db
from app.exceptions import ForbiddenError, NotFoundError
from app.schemas.stats import FormationStatsRead, RegimentStatsRead, StatBucket

router = APIRouter(prefix="/stats", tags=["stats"])


@router.get("/regiment/{regiment_id}", response_model=RegimentStatsRead)
async def get_regiment_stats(
    regiment_id: int,
    period: str = Query(default="all", pattern="^(day|week|month|all)$"),
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> RegimentStatsRead:
    if not (access.is_admin or access.is_high_command or regiment_id in access.own_regiment_ids):
        raise ForbiddenError("Нет доступа к статистике этого формирования")

    regiment = await regiment_crud.get_by_id(db, regiment_id)
    if regiment is None:
        raise NotFoundError("Формирование не найдено")

    cutoff = stats_crud.period_cutoff(period)

    person_counts = await stats_crud.count_by_person(db, regiment_id=regiment_id, cutoff=cutoff)
    users = {u.id: u for u in await user_crud.get_by_ids(db, [uid for uid, _ in person_counts])}
    by_person = [
        StatBucket(
            id=user_id,
            label=user_crud.format_full_name(users[user_id]) if user_id in users else "?",
            count=count,
            discord_id=users[user_id].discord_id if user_id in users else None,
        )
        for user_id, count in sorted(person_counts, key=lambda x: -x[1])
    ]

    category_counts = await stats_crud.count_by_category(db, regiment_id=regiment_id, cutoff=cutoff)
    category_names = await stats_crud.get_category_names(db, [cid for cid, _ in category_counts if cid is not None])
    by_category = [
        StatBucket(
            id=category_id,
            label=category_names.get(category_id, "Без категории") if category_id is not None else "Без категории",
            count=count,
        )
        for category_id, count in sorted(category_counts, key=lambda x: -x[1])
    ]

    return RegimentStatsRead(by_person=by_person, by_category=by_category)


@router.get("/formations", response_model=FormationStatsRead)
async def get_formation_stats(
    period: str = Query(default="all", pattern="^(day|week|month|all)$"),
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> FormationStatsRead:
    """Сравнение активности между формированиями — только администратор/высшее
    командование."""
    if not (access.is_admin or access.is_high_command):
        raise ForbiddenError("Сравнение формирований доступно только администратору или высшему командованию")

    cutoff = stats_crud.period_cutoff(period)
    counts = await stats_crud.count_by_regiment(db, cutoff=cutoff)
    regiments = {r.id: r for r in await regiment_crud.get_all(db)}
    by_regiment = [
        StatBucket(
            id=rid,
            label=regiments[rid].name if rid in regiments else f"#{rid}",
            count=count,
            color=regiments[rid].color if rid in regiments else None,
        )
        for rid, count in sorted(counts, key=lambda x: -x[1])
    ]
    return FormationStatsRead(by_regiment=by_regiment)
