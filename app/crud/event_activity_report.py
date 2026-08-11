from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.exceptions import AppError
from app.models.event_activity_report import EventActivityReport, EventActivityReportStatus
from app.models.user import User

# .selectinload(User.rank) обязателен — EventActivityReportRead.submitted_by
# читается как UserBrief (включает .rank) при сериализации ответа; без eager
# load это ленивая relationship, обращение к ней вне await в асинхронном
# SQLAlchemy падает MissingGreenlet (500) — тот же баг, что был в
# app/crud/event_booking.py (см. коммит-фикс), тут пропущен по той же причине.
_LOAD_OPTIONS = [
    selectinload(EventActivityReport.submitted_by).selectinload(User.rank),
    selectinload(EventActivityReport.decided_by).selectinload(User.rank),
]


async def list_all(db: AsyncSession, *, submitted_by_user_id: int | None = None) -> list[EventActivityReport]:
    query = select(EventActivityReport).options(*_LOAD_OPTIONS).order_by(EventActivityReport.created_at.desc())
    if submitted_by_user_id is not None:
        query = query.where(EventActivityReport.submitted_by_user_id == submitted_by_user_id)
    result = await db.execute(query)
    return list(result.scalars().all())


async def get_by_id(db: AsyncSession, report_id: int) -> EventActivityReport | None:
    return await db.get(EventActivityReport, report_id, options=_LOAD_OPTIONS, populate_existing=True)


async def create(
    db: AsyncSession, *, event_type: str, payload: dict, submitted_by_user_id: int
) -> EventActivityReport:
    row = EventActivityReport(event_type=event_type, payload=payload, submitted_by_user_id=submitted_by_user_id)
    db.add(row)
    await db.commit()
    return await db.get(EventActivityReport, row.id, options=_LOAD_OPTIONS, populate_existing=True)


async def decide(
    db: AsyncSession,
    report: EventActivityReport,
    *,
    approve: bool,
    decided_by_user_id: int,
    rejection_reason: str | None = None,
) -> EventActivityReport:
    # Защита от повторного решения (двойной клик/повтор запроса) — см.
    # app/crud/event.py::decide и promotion_crud.decide, тот же паттерн
    if report.status != EventActivityReportStatus.PENDING:
        raise AppError("Отчёт уже решён — повторное решение по нему невозможно")
    report.status = EventActivityReportStatus.APPROVED if approve else EventActivityReportStatus.REJECTED
    report.decided_by_user_id = decided_by_user_id
    report.decided_at = datetime.now(timezone.utc)
    report.rejection_reason = rejection_reason
    await db.commit()
    return await db.get(EventActivityReport, report.id, options=_LOAD_OPTIONS, populate_existing=True)


async def activity_summary_for_user_ids(db: AsyncSession, user_ids: list[int]) -> dict[int, dict]:
    """Кол-во ОДОБРЕННЫХ отчётов за 7д/30д/всё время + дата последнего,
    сгруппировано по submitted_by_user_id И по event_type — Мини-ивент и
    Боевой вылет считаются раздельно (см. решение пользователя), а не одной
    общей цифрой. Тот же приём, что и у Администрации, см.
    app/crud/admin_report.py::activity_summary_for_user_ids, но с
    дополнительной группировкой по типу."""
    if not user_ids:
        return {}
    now = datetime.now(timezone.utc)
    week_ago = now - timedelta(days=7)
    month_ago = now - timedelta(days=30)

    async def _counts_since(since: datetime | None) -> dict[tuple[int, str], int]:
        query = select(
            EventActivityReport.submitted_by_user_id, EventActivityReport.event_type, func.count(EventActivityReport.id)
        ).where(
            EventActivityReport.submitted_by_user_id.in_(user_ids),
            EventActivityReport.status == EventActivityReportStatus.APPROVED,
        )
        if since is not None:
            query = query.where(EventActivityReport.created_at >= since)
        query = query.group_by(EventActivityReport.submitted_by_user_id, EventActivityReport.event_type)
        result = await db.execute(query)
        return {(user_id, event_type): count for user_id, event_type, count in result.all()}

    count_week = await _counts_since(week_ago)
    count_month = await _counts_since(month_ago)
    count_all_time = await _counts_since(None)

    last_result = await db.execute(
        select(EventActivityReport.submitted_by_user_id, func.max(EventActivityReport.created_at))
        .where(
            EventActivityReport.submitted_by_user_id.in_(user_ids),
            EventActivityReport.status == EventActivityReportStatus.APPROVED,
        )
        .group_by(EventActivityReport.submitted_by_user_id)
    )
    last_report_at = dict(last_result.all())

    def _by_type(counts: dict[tuple[int, str], int], user_id: int, event_type: str) -> int:
        return counts.get((user_id, event_type), 0)

    return {
        user_id: {
            "mini": {
                "count_week": _by_type(count_week, user_id, "mini"),
                "count_month": _by_type(count_month, user_id, "mini"),
                "count_all_time": _by_type(count_all_time, user_id, "mini"),
            },
            "combat": {
                "count_week": _by_type(count_week, user_id, "combat"),
                "count_month": _by_type(count_month, user_id, "combat"),
                "count_all_time": _by_type(count_all_time, user_id, "combat"),
            },
            "last_report_at": last_report_at.get(user_id),
        }
        for user_id in user_ids
    }
