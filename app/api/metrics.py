"""Метрики для Zabbix. Запросы через Cloudflare Tunnel отклоняются — только локальный доступ."""
import time
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import String, cast, func, select

from app.database import Base, engine

router = APIRouter(tags=["metrics"])
_START_TIME = time.time()


def _age(now: datetime, ts: datetime | None) -> int:
    if ts is None:
        return 0
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    return int((now - ts).total_seconds())


@router.get("/metrics", include_in_schema=False)
async def metrics(request: Request) -> dict:
    if "cf-connecting-ip" in request.headers:
        raise HTTPException(status_code=404)

    now = datetime.now(timezone.utc)
    day_ago = now - timedelta(hours=24)
    tables = Base.metadata.tables
    users = tables["users"]
    reports = tables["reports"]

    async with engine.connect() as conn:
        async def scalar(stmt):
            return (await conn.execute(stmt)).scalar()

        count = select(func.count())
        result = {
            "uptime_seconds": int(time.time() - _START_TIME),
            "users_total": await scalar(count.select_from(users)),
            "users_pending_registration": await scalar(
                count.select_from(users).where(users.c.registration_status == "pending")),
            "users_active_24h": await scalar(
                count.select_from(users).where(users.c.last_login_at >= day_ago)),
            "reports_created_24h": await scalar(
                count.select_from(reports).where(reports.c.created_at >= day_ago)),
        }

        status_txt = cast(reports.c.status, String)
        rows = await conn.execute(
            select(status_txt, func.count()).group_by(status_txt))
        result["reports_by_status"] = [{"status": s, "count": c} for s, c in rows.all()]

        oldest = await scalar(
            select(func.min(reports.c.created_at)).where(status_txt == "submitted"))
        result["reports_oldest_submitted_age_seconds"] = _age(now, oldest)

        queues = []
        for name, table in sorted(tables.items()):
            if name in ("users", "reports") or "status" not in table.c:
                continue
            is_pending = cast(table.c.status, String) == "pending"
            pending = await scalar(count.select_from(table).where(is_pending))
            oldest_q = None
            if "created_at" in table.c:
                oldest_q = await scalar(select(func.min(table.c.created_at)).where(is_pending))
            queues.append({"queue": name, "pending": pending,
                           "oldest_pending_age_seconds": _age(now, oldest_q)})
        result["queues"] = queues

    return result
