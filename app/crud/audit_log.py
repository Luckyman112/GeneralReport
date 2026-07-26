from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.audit_log import AuditLog
from app.models.user import User

_LOAD_OPTIONS = [selectinload(AuditLog.actor).selectinload(User.rank)]


async def log(db: AsyncSession, *, actor_user_id: int, action: str, details: str) -> None:
    db.add(AuditLog(actor_user_id=actor_user_id, action=action, details=details))
    await db.commit()


async def list_recent(
    db: AsyncSession,
    *,
    limit: int = 200,
    action: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
) -> list[AuditLog]:
    query = select(AuditLog).options(*_LOAD_OPTIONS)
    if action:
        query = query.where(AuditLog.action.ilike(f"%{action}%"))
    if date_from is not None:
        query = query.where(AuditLog.created_at >= date_from)
    if date_to is not None:
        query = query.where(AuditLog.created_at <= date_to)
    query = query.order_by(AuditLog.created_at.desc()).limit(limit)
    result = await db.execute(query)
    return list(result.scalars().all())
