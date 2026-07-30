"""Дашборд здоровья системы — сколько активных бойцов и сколько заявок
(регистрация/перевод/повышение) висит без решения дольше N дней, чтобы не искать
проблему по разделам вручную."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AccessContext, get_access_context
from app.crud import promotion as promotion_crud
from app.crud import transfer_request as transfer_request_crud
from app.crud import user as user_crud
from app.database import get_db
from app.exceptions import ForbiddenError
from app.schemas.health import SystemHealthRead

router = APIRouter(prefix="/admin/health", tags=["health"])


@router.get("", response_model=SystemHealthRead)
async def get_system_health(
    stale_days: int = Query(default=3, ge=1, le=90),
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> SystemHealthRead:
    if not access.is_admin:
        raise ForbiddenError("Дашборд здоровья системы доступен только администратору")

    cutoff = datetime.now(timezone.utc).timestamp() - stale_days * 86400

    def is_stale(created_at) -> bool:
        ts = created_at if created_at.tzinfo else created_at.replace(tzinfo=timezone.utc)
        return ts.timestamp() < cutoff

    active_users_count = await user_crud.count_active(db)

    pending_registrations = await user_crud.list_pending_registrations(db)
    stuck_registrations = sum(1 for u in pending_registrations if is_stale(u.created_at))

    pending_transfers = await transfer_request_crud.list_all_pending(db)
    stuck_transfers = sum(1 for t in pending_transfers if is_stale(t.created_at))

    pending_promotions = await promotion_crud.list_pending(db, regiment_ids=None)
    stuck_promotions = sum(1 for p in pending_promotions if is_stale(p.created_at))

    return SystemHealthRead(
        active_users_count=active_users_count,
        stale_days=stale_days,
        stuck_registrations=stuck_registrations,
        stuck_transfers=stuck_transfers,
        stuck_promotions=stuck_promotions,
    )
