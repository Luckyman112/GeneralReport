from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.report import Report
from app.models.report_participant import ReportParticipant
from app.models.user import User


async def get_for_report(db: AsyncSession, report_id) -> list[ReportParticipant]:
    result = await db.execute(select(ReportParticipant).where(ReportParticipant.report_id == report_id))
    return list(result.scalars().all())


async def award(db: AsyncSession, *, report_id, user_id: int, points: int) -> None:
    """Идемпотентно: если участнику уже начислены баллы за этот рапорт (повторное
    одобрение после отклонения), не дублируем строку."""
    result = await db.execute(
        select(ReportParticipant).where(
            ReportParticipant.report_id == report_id, ReportParticipant.user_id == user_id
        )
    )
    existing = result.scalar_one_or_none()
    if existing is not None:
        existing.points = points
    else:
        db.add(ReportParticipant(report_id=report_id, user_id=user_id, points=points))
    await db.commit()


async def list_reports_since(
    db: AsyncSession, *, user_id: int, since=None, regiment_id: int | None = None
) -> list[Report]:
    """Рапорты, где пользователь указан как участник (ростер-поле) — используется и
    для обзора повышения (since=дата начала текущего звания, чтобы показать только
    те, за участие в которых были начислены баллы), и для полного личного дела
    участника (since=None — все рапорты за всё время, regiment_id — сузить до
    рапортов конкретного формирования)."""
    query = select(Report).join(ReportParticipant, ReportParticipant.report_id == Report.id).where(
        ReportParticipant.user_id == user_id
    )
    if since is not None:
        query = query.where(Report.created_at >= since)
    if regiment_id is not None:
        query = query.where(Report.regiment_id == regiment_id)
    query = query.options(
        selectinload(Report.images),
        selectinload(Report.author).selectinload(User.rank),
        selectinload(Report.updated_by_user).selectinload(User.rank),
        selectinload(Report.target_rank),
        selectinload(Report.author_rank),
        selectinload(Report.updated_by_rank),
    ).order_by(Report.created_at.desc())
    result = await db.execute(query)
    return list(result.scalars().all())


async def sum_points_for_user(db: AsyncSession, *, user_id: int, since=None) -> int:
    query = select(func.coalesce(func.sum(ReportParticipant.points), 0)).where(ReportParticipant.user_id == user_id)
    if since is not None:
        query = query.join(Report, Report.id == ReportParticipant.report_id).where(Report.created_at >= since)
    result = await db.execute(query)
    return int(result.scalar_one())
