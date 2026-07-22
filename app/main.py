"""Точка входа FastAPI-приложения COLLAPSAR Report System."""
import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.auth import router as auth_router
from app.api.me import router as me_router
from app.api.regiments import router as regiments_router
from app.api.reports import router as reports_router
from app.config import settings
from app.database import engine
from app.exceptions import register_exception_handlers
from app.logging_config import setup_logging

setup_logging()
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    logger.info("COLLAPSAR Report System запущен")
    yield
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


@app.get("/health", tags=["health"])
async def health_check() -> dict:
    return {"status": "ok"}
