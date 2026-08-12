from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.exceptions import AppError
from app.models.admin_reprimand import AdminReprimand
from app.models.user import User

# .selectinload(User.rank) обязателен — target/issuer читаются как UserBrief
# при сериализации ответа, см. CLAUDE.md ("...обязательно должен...") — тот же
# баг, что был в admin_report.py/event_booking.py и др.
_LOAD_OPTIONS = [
    selectinload(AdminReprimand.target).selectinload(User.rank),
    selectinload(AdminReprimand.issuer).selectinload(User.rank),
]


async def list_for_target(db: AsyncSession, *, target_user_id: int) -> list[AdminReprimand]:
    """Вся история выговоров этого бойца (активные + снятые) — для
    AdminMemberDetailModal."""
    result = await db.execute(
        select(AdminReprimand)
        .where(AdminReprimand.target_user_id == target_user_id)
        .options(*_LOAD_OPTIONS)
        .order_by(AdminReprimand.issued_at.desc())
    )
    return list(result.scalars().all())


async def count_active_for_user_ids(db: AsyncSession, user_ids: list[int]) -> dict[int, int]:
    """Кол-во активных (не снятых) выговоров на каждого — для бейджа в сводке
    активности."""
    if not user_ids:
        return {}
    result = await db.execute(
        select(AdminReprimand.target_user_id, func.count(AdminReprimand.id))
        .where(AdminReprimand.target_user_id.in_(user_ids), AdminReprimand.revoked_at.is_(None))
        .group_by(AdminReprimand.target_user_id)
    )
    return dict(result.all())


async def get_by_id(db: AsyncSession, reprimand_id: int) -> AdminReprimand | None:
    return await db.get(AdminReprimand, reprimand_id, options=_LOAD_OPTIONS, populate_existing=True)


async def create(
    db: AsyncSession, *, target_user_id: int, reason: str, severity: str, issued_by_user_id: int
) -> AdminReprimand:
    reprimand = AdminReprimand(
        target_user_id=target_user_id, reason=reason, severity=severity, issued_by_user_id=issued_by_user_id
    )
    db.add(reprimand)
    await db.commit()
    return await get_by_id(db, reprimand.id)


async def revoke(db: AsyncSession, reprimand: AdminReprimand, *, revoked_by_user_id: int) -> AdminReprimand:
    # Защита от повторного снятия — тот же паттерн, что reprimand_crud.revoke
    if reprimand.revoked_at is not None:
        raise AppError("Выговор уже снят — повторное снятие невозможно")
    reprimand.revoked_at = datetime.now(timezone.utc)
    reprimand.revoked_by_user_id = revoked_by_user_id
    await db.commit()
    return await get_by_id(db, reprimand.id)
