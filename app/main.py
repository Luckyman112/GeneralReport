"""Точка входа FastAPI-приложения COLLAPSAR Report System."""
import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.app_settings import router as app_settings_router
from app.api.audit_log import router as audit_log_router
from app.api.auth import router as auth_router
from app.api.backups import router as backups_router
from app.api.leave_requests import router as leave_requests_router
from app.api.me import router as me_router
from app.api.module_access import router as module_access_router
from app.api.notifications import router as notifications_router
from app.api.promotions import router as promotions_router
from app.api.ranks import router as ranks_router
from app.api.registration import router as registration_router
from app.api.regiments import router as regiments_router
from app.api.reprimands import regiment_router as reprimands_regiment_router
from app.api.reprimands import router as reprimands_router
from app.api.reports import router as reports_router
from app.api.stats import router as stats_router
from app.api.violations import router as violations_router
from app.config import settings
from app.core import backup_scheduler
from app.database import engine
from app.exceptions import register_exception_handlers
from app.logging_config import setup_logging

setup_logging()
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    logger.info("COLLAPSAR Report System запущен")
    backup_scheduler.start()
    yield
    backup_scheduler.stop()
    await engine.dispose()
    logger.info("COLLAPSAR Report System остановлен")


app = FastAPI(
    title="COLLAPSAR Report System",
    description="API для сбора и управления рапортами боевых формирований",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

register_exception_handlers(app)

app.include_router(auth_router)
app.include_router(reports_router, prefix="/api")
app.include_router(regiments_router, prefix="/api")
app.include_router(me_router, prefix="/api")
app.include_router(app_settings_router, prefix="/api")
app.include_router(ranks_router, prefix="/api")
app.include_router(violations_router, prefix="/api")
app.include_router(notifications_router, prefix="/api")
app.include_router(module_access_router, prefix="/api")
app.include_router(reprimands_router, prefix="/api")
app.include_router(reprimands_regiment_router, prefix="/api")
app.include_router(promotions_router, prefix="/api")
app.include_router(stats_router, prefix="/api")
app.include_router(backups_router, prefix="/api")
app.include_router(registration_router, prefix="/api")
app.include_router(leave_requests_router, prefix="/api")
app.include_router(audit_log_router, prefix="/api")


@app.get("/health", tags=["health"])
async def health_check() -> dict:
    return {"status": "ok"}


# Прикреплённые к рапортам картинки — хранятся на диске этого компьютера. Монтируется
# до catch-all фронта, иначе тот перекроет собой /uploads/*.
_uploads_dir = Path(__file__).resolve().parent.parent / "uploads"
_uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=_uploads_dir), name="uploads")

# Self-host: раздаём собранный фронт тем же процессом (frontend/dist после npm run
# build), same-origin с API — без GitHub Pages. Монтируется последним, чтобы не
# перекрыть /api, /auth, /health, /uploads.
_frontend_dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if _frontend_dist.is_dir():
    app.mount("/", StaticFiles(directory=_frontend_dist, html=True), name="frontend")
else:
    logger.warning("frontend/dist не найден (%s) — фронт не раздаётся, только API", _frontend_dist)
