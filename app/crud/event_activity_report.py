from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.event_activity_report import EventActivityReport, EventActivityReportStatus

_LOAD_OPTIONS = [
    selectinload(EventActivityReport.submitted_by),
    selectinload(EventActivityReport.decided_by),
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
    report.status = EventActivityReportStatus.APPROVED if approve else EventActivityReportStatus.REJECTED
    report.decided_by_user_id = decided_by_user_id
    report.decided_at = datetime.now(timezone.utc)
    report.rejection_reason = rejection_reason
    await db.commit()
    return await db.get(EventActivityReport, report.id, options=_LOAD_OPTIONS, populate_existing=True)


async def activity_summary_for_user_ids(db: AsyncSession, user_ids: list[int]) -> dict[int, dict]:
    """Кол-во ОДОБРЕННЫХ отчётов за 7д/30д/всё время + дата последнего,
    сгруппировано по submitted_by_user_id (тот же приём, что и у Администрации,
    см. app/crud/admin_report.py::activity_summary_for_user_ids)."""
    if not user_ids:
        return {}
    now = datetime.now(timezone.utc)
    week_ago = now - timedelta(days=7)
    month_ago = now - timedelta(days=30)

    async def _counts_since(since: datetime | None) -> dict[int, int]:
        query = select(EventActivityReport.submitted_by_user_id, func.count(EventActivityReport.id)).where(
            EventActivityReport.submitted_by_user_id.in_(user_ids),
            EventActivityReport.status == EventActivityReportStatus.APPROVED,
        )
        if since is not None:
            query = query.where(EventActivityReport.created_at >= since)
        query = query.group_by(EventActivityReport.submitted_by_user_id)
        result = await db.execute(query)
        return dict(result.all())

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

    return {
        user_id: {
            "count_week": count_week.get(user_id, 0),
            "count_month": count_month.get(user_id, 0),
            "count_all_time": count_all_time.get(user_id, 0),
            "last_report_at": last_report_at.get(user_id),
        }
        for user_id in user_ids
    }
