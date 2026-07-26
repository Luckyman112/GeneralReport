"""Автоматический ежедневный бэкап БД — фоновая asyncio-задача внутри lifespan
приложения, без внешнего планировщика (APScheduler/cron) и новых зависимостей.
Не переживает перезапуск процесса — если сервер перезапустили посреди дня, следующий
бэкап случится через сутки от момента запуска, а не по "стенным часам"; для этого
масштаба (самохостящийся проект) этого достаточно."""
import asyncio
import logging

from app.api.backups import run_pg_dump
from app.config import settings

logger = logging.getLogger(__name__)

_task: asyncio.Task | None = None


async def _loop() -> None:
    interval_seconds = settings.auto_backup_interval_hours * 3600
    while True:
        try:
            await asyncio.sleep(interval_seconds)
            await asyncio.to_thread(run_pg_dump, label="автобэкап по расписанию")
            logger.info("Автобэкап по расписанию выполнен успешно")
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Автобэкап по расписанию завершился с ошибкой")


def start() -> None:
    global _task
    if not settings.auto_backup_enabled:
        logger.info("Автобэкап по расписанию выключен (AUTO_BACKUP_ENABLED=false)")
        return
    _task = asyncio.create_task(_loop())
    logger.info("Автобэкап по расписанию запущен, интервал %s ч.", settings.auto_backup_interval_hours)


def stop() -> None:
    if _task is not None:
        _task.cancel()
