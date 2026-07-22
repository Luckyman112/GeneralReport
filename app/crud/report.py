import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.report import Report, ReportStatus


async def create_report(
    db: AsyncSession, *, user_id: int, regiment_id: int, content: str, status: ReportStatus
) -> Report:
    report = Report(user_id=user_id, regiment_id=regiment_id, content=content, status=status)
    db.add(report)
    await db.commit()
    await db.refresh(report)
    return report


async def get_by_id(db: AsyncSession, report_id: uuid.UUID) -> Report | None:
    return await db.get(Report, report_id)


async def list_reports(
    db: AsyncSession,
    *,
    regiment_ids: list[int] | None = None,
    user_id: int | None = None,
    status: ReportStatus | None = None,
) -> list[Report]:
    """Список рапортов с опциональными фильтрами.

    regiment_ids=None означает "без ограничения по формированиям" (для администратора),
    иначе рапорты ограничиваются переданным списком формирований (доступных пользователю).
    """
    query = select(Report).order_by(Report.created_at.desc())

    if regiment_ids is not None:
        query = query.where(Report.regiment_id.in_(regiment_ids))
    if user_id is not None:
        query = query.where(Report.user_id == user_id)
    if status is not None:
        query = query.where(Report.status == status)
    else:
        # По умолчанию не показываем удалённые рапорты, если статус не запрошен явно
        query = query.where(Report.status != ReportStatus.DELETED)

    result = await db.execute(query)
    return list(result.scalars().all())


async def update_status(
    db: AsyncSession,
    report: Report,
    *,
    status: ReportStatus,
    updated_by: int,
    rejection_reason: str | None = None,
) -> Report:
    report.status = status
    report.updated_by = updated_by
    report.rejection_reason = rejection_reason
    if status == ReportStatus.DELETED:
        report.deleted_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(report)
    return report


async def soft_delete(db: AsyncSession, report: Report, *, updated_by: int) -> Report:
    return await update_status(db, report, status=ReportStatus.DELETED, updated_by=updated_by)
