"""Кастомные исключения приложения и их обработчики для FastAPI."""
import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)


class AppError(Exception):
    """Базовая ошибка приложения с HTTP-статусом и понятным сообщением."""

    status_code = 400

    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


class NotFoundError(AppError):
    status_code = 404


class ForbiddenError(AppError):
    status_code = 403


class UnauthorizedError(AppError):
    status_code = 401


class DiscordAPIError(AppError):
    """Ошибка при обращении к Discord API (OAuth, получение ролей и т.д.)."""

    status_code = 502


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
        logger.warning("AppError на %s: %s", request.url.path, exc.message)
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.message})

    @app.exception_handler(Exception)
    async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("Необработанная ошибка на %s", request.url.path)
        return JSONResponse(
            status_code=500,
            content={"detail": "Внутренняя ошибка сервера. Попробуйте позже."},
        )
