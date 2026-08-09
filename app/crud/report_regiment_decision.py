from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.report_regiment_decision import RegimentDecisionStatus, ReportRegimentDecision

_LOAD_OPTIONS = [selectinload(ReportRegimentDecision.regiment), selectinload(ReportRegimentDecision.decided_by_user)]


async def create_pending_for_regiments(
    db: AsyncSession, *, report_id: UUID, regiment_ids: list[int]
) -> list[ReportRegimentDecision]:
    decisions = [ReportRegimentDecision(report_id=report_id, regiment_id=rid) for rid in regiment_ids]
    db.add_all(decisions)
    await db.commit()
    return await list_for_report(db, report_id)


async def get_by_report_and_regiment(
    db: AsyncSession, *, report_id: UUID, regiment_id: int
) -> ReportRegimentDecision | None:
    # populate_existing=True обязателен: без него повторный запрос по уже
    # загруженному в сессию решению (например, после decide()) вернёт объект из
    # identity map с устаревшим decided_by_user (см. тот же паттерн в report_crud.get_by_id)
    result = await db.execute(
        select(ReportRegimentDecision)
        .where(ReportRegimentDecision.report_id == report_id, ReportRegimentDecision.regiment_id == regiment_id)
        .options(*_LOAD_OPTIONS)
        .execution_options(populate_existing=True)
    )
    return result.scalar_one_or_none()


async def list_for_report(db: AsyncSession, report_id: UUID) -> list[ReportRegimentDecision]:
    result = await db.execute(
        select(ReportRegimentDecision)
        .where(ReportRegimentDecision.report_id == report_id)
        .options(*_LOAD_OPTIONS)
        .execution_options(populate_existing=True)
    )
    return list(result.scalars().all())


async def list_for_reports(db: AsyncSession, report_ids: list[UUID]) -> list[ReportRegimentDecision]:
    if not report_ids:
        return []
    result = await db.execute(
        select(ReportRegimentDecision)
        .where(ReportRegimentDecision.report_id.in_(report_ids))
        .options(*_LOAD_OPTIONS)
        .execution_options(populate_existing=True)
    )
    return list(result.scalars().all())


async def decide(
    db: AsyncSession,
    decision: ReportRegimentDecision,
    *,
    status: RegimentDecisionStatus,
    decided_by: int,
    rejection_reason: str | None = None,
    mirror_report_id: UUID | None = None,
) -> ReportRegimentDecision:
    decision.status = status
    decision.decided_by = decided_by
    decision.decided_at = datetime.now(timezone.utc)
    decision.rejection_reason = rejection_reason
    if mirror_report_id is not None:
        decision.mirror_report_id = mirror_report_id
    await db.commit()
    return await get_by_report_and_regiment(db, report_id=decision.report_id, regiment_id=decision.regiment_id)
