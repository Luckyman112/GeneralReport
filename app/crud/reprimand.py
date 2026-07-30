from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.report import Report, ReportStatus
from app.models.reprimand import Reprimand
from app.models.user import User

_LOAD_OPTIONS = [
    selectinload(Reprimand.target).selectinload(User.rank),
    selectinload(Reprimand.issuer).selectinload(User.rank),
]


async def list_active_for_user(db: AsyncSession, *, user_id: int) -> list[Reprimand]:
    result = await db.execute(
        select(Reprimand)
        .where(Reprimand.target_user_id == user_id, Reprimand.revoked_at.is_(None))
        .options(*_LOAD_OPTIONS)
    )
    return list(result.scalars().all())


async def has_active_reprimand(db: AsyncSession, *, user_id: int) -> bool:
    """Только строгие выговоры блокируют повышение — устные сами по себе ничего
    не ограничивают."""
    active = await list_active_for_user(db, user_id=user_id)
    return any(r.severity == "strict" for r in active)


async def count_active_verbal(db: AsyncSession, *, user_id: int, regiment_id: int) -> int:
    result = await db.execute(
        select(func.count(Reprimand.id)).where(
            Reprimand.target_user_id == user_id,
            Reprimand.regiment_id == regiment_id,
            Reprimand.severity == "verbal",
            Reprimand.revoked_at.is_(None),
        )
    )
    return int(result.scalar_one())


async def list_for_regiment(db: AsyncSession, *, regiment_id: int) -> list[Reprimand]:
    result = await db.execute(
        select(Reprimand)
        .where(Reprimand.regiment_id == regiment_id)
        .options(*_LOAD_OPTIONS)
        .order_by(Reprimand.issued_at.desc())
    )
    return list(result.scalars().all())


async def list_all(db: AsyncSession) -> list[Reprimand]:
    result = await db.execute(select(Reprimand).options(*_LOAD_OPTIONS).order_by(Reprimand.issued_at.desc()))
    return list(result.scalars().all())


async def list_by_regiments(db: AsyncSession, *, regiment_ids: set[int]) -> list[Reprimand]:
    if not regiment_ids:
        return []
    result = await db.execute(
        select(Reprimand)
        .where(Reprimand.regiment_id.in_(regiment_ids))
        .options(*_LOAD_OPTIONS)
        .order_by(Reprimand.issued_at.desc())
    )
    return list(result.scalars().all())


async def list_by_target_user(db: AsyncSession, *, user_id: int) -> list[Reprimand]:
    result = await db.execute(
        select(Reprimand)
        .where(Reprimand.target_user_id == user_id)
        .options(*_LOAD_OPTIONS)
        .order_by(Reprimand.issued_at.desc())
    )
    return list(result.scalars().all())


async def get_by_id(db: AsyncSession, reprimand_id: int) -> Reprimand | None:
    return await db.get(Reprimand, reprimand_id, options=_LOAD_OPTIONS, populate_existing=True)


async def points_earned_since(db: AsyncSession, *, user_id: int, since) -> int:
    result = await db.execute(
        select(func.coalesce(func.sum(Report.points), 0)).where(
            Report.user_id == user_id, Report.status == ReportStatus.APPROVED, Report.created_at >= since
        )
    )
    return int(result.scalar_one())


async def create(
    db: AsyncSession,
    *,
    target_user_id: int,
    regiment_id: int,
    reason: str,
    issued_by: int,
    severity: str = "strict",
    points_required: int = 0,
) -> Reprimand:
    reprimand = Reprimand(
        target_user_id=target_user_id,
        regiment_id=regiment_id,
        reason=reason,
        issued_by=issued_by,
        severity=severity,
        points_required=points_required,
    )
    db.add(reprimand)
    await db.commit()

    # Второй одновременно активный устный выговор одному и тому же бойцу в этом
    # формировании автоматически создаёт дополнительный строгий
    if severity == "verbal":
        verbal_count = await count_active_verbal(db, user_id=target_user_id, regiment_id=regiment_id)
        if verbal_count >= 2:
            escalation = Reprimand(
                target_user_id=target_user_id,
                regiment_id=regiment_id,
                reason="Автоматически: получено 2 устных предупреждения",
                issued_by=issued_by,
                severity="strict",
                points_required=points_required,
                auto_escalated=True,
            )
            db.add(escalation)
            await db.commit()

    return await get_by_id(db, reprimand.id)


async def revoke(db: AsyncSession, reprimand: Reprimand, *, revoked_by: int) -> Reprimand:
    from datetime import datetime, timezone

    reprimand.revoked_at = datetime.now(timezone.utc)
    reprimand.revoked_by = revoked_by
    await db.commit()
    return await get_by_id(db, reprimand.id)


async def delete(db: AsyncSession, reprimand: Reprimand) -> None:
    # hard delete, vs revoke which just closes an active reprimand
    await db.delete(reprimand)
    await db.commit()


async def set_appeal(db: AsyncSession, reprimand: Reprimand, *, appeal_text: str) -> Reprimand:
    reprimand.appeal_text = appeal_text
    await db.commit()
    return await get_by_id(db, reprimand.id)
