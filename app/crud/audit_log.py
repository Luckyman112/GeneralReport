from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.audit_log import AuditLog
from app.models.user import User

_LOAD_OPTIONS = [selectinload(AuditLog.actor).selectinload(User.rank)]


async def log(db: AsyncSession, *, actor_user_id: int, action: str, details: str) -> None:
    db.add(AuditLog(actor_user_id=actor_user_id, action=action, details=details))
    await db.commit()


async def list_recent(db: AsyncSession, *, limit: int = 200) -> list[AuditLog]:
    result = await db.execute(
        select(AuditLog).options(*_LOAD_OPTIONS).order_by(AuditLog.created_at.desc()).limit(limit)
    )
    return list(result.scalars().all())
