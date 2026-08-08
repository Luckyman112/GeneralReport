from datetime import datetime, timedelta, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.report import Report, ReportStatus
from app.models.report_category import ReportCategory

PERIOD_DELTAS = {
    "day": timedelta(days=1),
    "week": timedelta(days=7),
    "month": timedelta(days=30),
}


def period_cutoff(period: str) -> datetime | None:
    delta = PERIOD_DELTAS.get(period)
    if delta is None:
        return None
    return datetime.now(timezone.utc) - delta


def _exclude_promotion_mirrors(query):
    """Заявки на повышение системно дублируются в "Нарушители"/рапорты как
    записи категории is_promotion (см. app/models/report_category.py) — в
    статистике/графиках по рапортам их считать не нужно, это не рапорт,
    поданный человеком. Внешнее соединение, чтобы рапорты вовсе без
    категории (category_id IS NULL) не отфильтровались заодно."""
    return query.outerjoin(ReportCategory, Report.category_id == ReportCategory.id).where(
        or_(ReportCategory.id.is_(None), ReportCategory.is_promotion.is_(False))
    )


async def count_by_person(db: AsyncSession, *, regiment_id: int, cutoff: datetime | None) -> list[tuple[int, int]]:
    """Возвращает [(user_id, count), ...]."""
    query = select(Report.user_id, func.count(Report.id)).where(
        Report.regiment_id == regiment_id, Report.status != ReportStatus.DELETED
    )
    query = _exclude_promotion_mirrors(query)
    if cutoff is not None:
        query = query.where(Report.created_at >= cutoff)
    query = query.group_by(Report.user_id)
    result = await db.execute(query)
    return list(result.all())


async def count_by_category(
    db: AsyncSession, *, regiment_id: int, cutoff: datetime | None
) -> list[tuple[int | None, int]]:
    """Возвращает [(category_id_or_None, count), ...]."""
    query = select(Report.category_id, func.count(Report.id)).where(
        Report.regiment_id == regiment_id, Report.status != ReportStatus.DELETED
    )
    query = _exclude_promotion_mirrors(query)
    if cutoff is not None:
        query = query.where(Report.created_at >= cutoff)
    query = query.group_by(Report.category_id)
    result = await db.execute(query)
    return list(result.all())


async def count_by_regiment(db: AsyncSession, *, cutoff: datetime | None) -> list[tuple[int, int]]:
    """Возвращает [(regiment_id, count), ...] — для сравнения активности формирований."""
    query = select(Report.regiment_id, func.count(Report.id)).where(Report.status != ReportStatus.DELETED)
    query = _exclude_promotion_mirrors(query)
    if cutoff is not None:
        query = query.where(Report.created_at >= cutoff)
    query = query.group_by(Report.regiment_id)
    result = await db.execute(query)
    return list(result.all())


async def count_by_regiment_daily(db: AsyncSession, *, days: int) -> list[tuple[int, str, int]]:
    """Возвращает [(regiment_id, 'YYYY-MM-DD', count), ...] за последние `days` дней —
    для графика тренда активности формирований."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days - 1)
    day_expr = func.to_char(Report.created_at, "YYYY-MM-DD")
    query = select(Report.regiment_id, day_expr, func.count(Report.id)).where(
        Report.status != ReportStatus.DELETED, Report.created_at >= cutoff
    )
    query = _exclude_promotion_mirrors(query)
    query = query.group_by(Report.regiment_id, day_expr)
    result = await db.execute(query)
    return list(result.all())


async def get_category_names(db: AsyncSession, category_ids: list[int]) -> dict[int, str]:
    if not category_ids:
        return {}
    result = await db.execute(select(ReportCategory.id, ReportCategory.name).where(ReportCategory.id.in_(category_ids)))
    return dict(result.all())
