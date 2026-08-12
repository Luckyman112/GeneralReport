from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.exceptions import AppError
from app.models.admin_report import AdminReport, AdminReportStatus
from app.models.user import User

# .selectinload(User.rank) обязателен — AdminReportRead.submitted_by читается
# как UserBrief (включает .rank) при сериализации ответа; без eager load это
# ленивая relationship, обращение к ней вне await в асинхронном SQLAlchemy
# падает MissingGreenlet (500) — тот же баг, что был в
# app/crud/event_booking.py/event_activity_report.py (см. коммиты-фиксы).
_LOAD_OPTIONS = [
    selectinload(AdminReport.submitted_by).selectinload(User.rank),
    selectinload(AdminReport.decided_by).selectinload(User.rank),
]


async def list_all(db: AsyncSession, *, submitted_by_user_id: int | None = None) -> list[AdminReport]:
    """submitted_by_user_id задан — только отчёты этого бойца (обычный
    Администрация видит свои); не задан — все отчёты (Senior+/ответственный
    Middle видит очередь на решение)."""
    query = select(AdminReport).options(*_LOAD_OPTIONS).order_by(AdminReport.created_at.desc())
    if submitted_by_user_id is not None:
        query = query.where(AdminReport.submitted_by_user_id == submitted_by_user_id)
    result = await db.execute(query)
    return list(result.scalars().all())


async def get_by_id(db: AsyncSession, report_id: int) -> AdminReport | None:
    return await db.get(AdminReport, report_id, options=_LOAD_OPTIONS, populate_existing=True)


async def create(db: AsyncSession, *, report_type: str, payload: dict, submitted_by_user_id: int) -> AdminReport:
    row = AdminReport(report_type=report_type, payload=payload, submitted_by_user_id=submitted_by_user_id)
    db.add(row)
    await db.commit()
    return await db.get(AdminReport, row.id, options=_LOAD_OPTIONS, populate_existing=True)


async def decide(
    db: AsyncSession, report: AdminReport, *, approve: bool, decided_by_user_id: int, rejection_reason: str | None = None
) -> AdminReport:
    # Защита от повторного решения (двойной клик/повтор запроса) — см.
    # app/crud/event.py::decide и promotion_crud.decide, тот же паттерн
    if report.status != AdminReportStatus.PENDING:
        raise AppError("Отчёт уже решён — повторное решение по нему невозможно")
    report.status = AdminReportStatus.APPROVED if approve else AdminReportStatus.REJECTED
    report.decided_by_user_id = decided_by_user_id
    report.decided_at = datetime.now(timezone.utc)
    report.rejection_reason = rejection_reason
    await db.commit()
    return await db.get(AdminReport, report.id, options=_LOAD_OPTIONS, populate_existing=True)


async def activity_summary_for_user_ids(db: AsyncSession, user_ids: list[int]) -> dict[int, dict]:
    """Для сводки активности: кол-во ОДОБРЕННЫХ отчётов за 7д/30д/всё время +
    дата последнего одобренного, сгруппировано по submitted_by_user_id. Один
    проход по таблице на каждое окно — таблица небольшая (личный состав
    Администрации), три отдельных подсчёта проще и понятнее, чем один
    CASE WHEN агрегат."""
    if not user_ids:
        return {}
    now = datetime.now(timezone.utc)
    week_ago = now - timedelta(days=7)
    month_ago = now - timedelta(days=30)

    async def _counts_since(since: datetime | None) -> dict[int, int]:
        query = select(AdminReport.submitted_by_user_id, func.count(AdminReport.id)).where(
            AdminReport.submitted_by_user_id.in_(user_ids), AdminReport.status == AdminReportStatus.APPROVED
        )
        if since is not None:
            query = query.where(AdminReport.created_at >= since)
        query = query.group_by(AdminReport.submitted_by_user_id)
        result = await db.execute(query)
        return dict(result.all())

    count_week = await _counts_since(week_ago)
    count_month = await _counts_since(month_ago)
    count_all_time = await _counts_since(None)

    last_result = await db.execute(
        select(AdminReport.submitted_by_user_id, func.max(AdminReport.created_at))
        .where(AdminReport.submitted_by_user_id.in_(user_ids), AdminReport.status == AdminReportStatus.APPROVED)
        .group_by(AdminReport.submitted_by_user_id)
    )
    last_report_at = dict(last_result.all())

    return {
        user_id: {
            "count_week": count_week.get(user_id, 0),
            "count_month": count_month.get(user_id, 0),
            "count_all_time": count_all_time.get(user_id, 0),
            "last_report_at": last_report_at.get(user_id),
        }
        for user_id in user_ids
    }


async def daily_type_counts(db: AsyncSession, *, since: datetime, until: datetime) -> dict[str, dict[str, int]]:
    """Кол-во ОДОБРЕННЫХ отчётов по дням, раздельно "activity"/"punishment" —
    для графика активности (TrendChart), см. app/api/admin_reports.py. Вся
    Администрация разом, тот же приём, что
    event_activity_report_crud.daily_type_counts/stats_crud.count_by_regiment_daily."""
    day_expr = func.to_char(AdminReport.created_at, "YYYY-MM-DD")
    query = (
        select(day_expr, AdminReport.report_type, func.count(AdminReport.id))
        .where(
            AdminReport.status == AdminReportStatus.APPROVED,
            AdminReport.created_at >= since,
            AdminReport.created_at < until,
        )
        .group_by(day_expr, AdminReport.report_type)
    )
    result = await db.execute(query)
    by_day: dict[str, dict[str, int]] = {}
    for day, report_type, count in result.all():
        by_day.setdefault(day, {})[report_type] = count
    return by_day
