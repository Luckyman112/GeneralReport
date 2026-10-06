import re
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.audit_log import AuditLog
from app.models.user import User

_LOAD_OPTIONS = [
    selectinload(AuditLog.actor).selectinload(User.rank),
    selectinload(AuditLog.target).selectinload(User.rank),
]


async def log(
    db: AsyncSession,
    *,
    actor_user_id: int,
    action: str,
    details: str,
    target_user_id: int | None = None,
    actor_is_admin: bool = False,
    discipline: str | None = None,
) -> None:
    db.add(
        AuditLog(
            actor_user_id=actor_user_id,
            action=action,
            details=details,
            target_user_id=target_user_id,
            actor_is_admin=actor_is_admin,
            discipline=discipline,
        )
    )
    await db.commit()


async def log_coalesced(
    db: AsyncSession,
    *,
    actor_user_id: int,
    action: str,
    details: str,
    actor_is_admin: bool = False,
    window_minutes: int = 30,
) -> None:
    """Как log(), но повторы того же действия того же человека в пределах окна
    склеиваются в одну запись со счётчиком. Нужно для автосохранений (карта
    галактики сохраняется после каждой правки): иначе одна сессия правки давала
    десятки одинаковых строк и забивала журнал."""
    since = datetime.now(timezone.utc) - timedelta(minutes=window_minutes)
    last = (
        await db.execute(
            select(AuditLog)
            .where(
                AuditLog.actor_user_id == actor_user_id,
                AuditLog.action == action,
                AuditLog.created_at >= since,
            )
            .order_by(AuditLog.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if last is None:
        await log(db, actor_user_id=actor_user_id, action=action, details=details, actor_is_admin=actor_is_admin)
        return
    m = re.search(r"сохранений: (\d+)\)$", last.details or "")
    count = (int(m.group(1)) if m else 1) + 1
    last.details = f"{details} (сохранений: {count})"
    last.created_at = datetime.now(timezone.utc)
    await db.commit()


async def list_for_target(db: AsyncSession, *, target_user_id: int, limit: int = 100) -> list[AuditLog]:
    """История действий над конкретным бойцом — для личного дела (правки профиля
    и т.п.), в отличие от list_recent (общий журнал для админа)."""
    result = await db.execute(
        select(AuditLog)
        .options(*_LOAD_OPTIONS)
        .where(AuditLog.target_user_id == target_user_id)
        .order_by(AuditLog.created_at.desc())
        .limit(limit)
    )
    return list(result.scalars().all())


async def list_recent(
    db: AsyncSession,
    *,
    limit: int = 200,
    action: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    admin_only: bool = False,
    discipline: str | None = None,
    actions: list[str] | None = None,
) -> list[AuditLog]:
    query = select(AuditLog).options(*_LOAD_OPTIONS)
    if action:
        query = query.where(AuditLog.action.ilike(f"%{action}%"))
    if actions:
        query = query.where(AuditLog.action.in_(actions))
    if date_from is not None:
        query = query.where(AuditLog.created_at >= date_from)
    if date_to is not None:
        query = query.where(AuditLog.created_at <= date_to)
    if admin_only:
        query = query.where(AuditLog.actor_is_admin.is_(True))
    if discipline is not None:
        query = query.where(AuditLog.discipline == discipline)
    query = query.order_by(AuditLog.created_at.desc()).limit(limit)
    result = await db.execute(query)
    return list(result.scalars().all())
