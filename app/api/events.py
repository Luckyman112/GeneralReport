"""SSE-канал живых обновлений — фронт держит одно долгоживущее соединение и сразу
узнаёт о новых рапортах/заявках/уведомлениях вместо периодического опроса API.
Токен передаётся query-параметром, а не заголовком — EventSource в браузере не
умеет отправлять кастомные заголовки."""
import asyncio
import logging

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

from app.core.events import event_bus
from app.core.security import decode_access_token
from app.exceptions import UnauthorizedError

logger = logging.getLogger(__name__)

router = APIRouter(tags=["events"])

_PING_INTERVAL_SECONDS = 25


@router.get("/events")
async def stream_events(token: str = Query(...)) -> StreamingResponse:
    try:
        decode_access_token(token)
    except Exception as exc:
        raise UnauthorizedError("Недействительный или истёкший токен сессии") from exc

    queue = event_bus.subscribe()

    async def event_generator():
        try:
            while True:
                try:
                    event_type = await asyncio.wait_for(queue.get(), timeout=_PING_INTERVAL_SECONDS)
                    yield f"data: {event_type}\n\n"
                except asyncio.TimeoutError:
                    # Комментарий-строка держит соединение живым через прокси/таймауты
                    yield ": ping\n\n"
        finally:
            event_bus.unsubscribe(queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
