"""Простой rate-limit на весь API целиком (в дополнение к отдельному, более
строгому лимиту на подбор пароля в app/api/auth.py) — защита от скрапинга/
случайного цикла на фронте, не рассчитан на защиту от серьёзного DDoS.
In-memory, per-IP, скользящее окно — как и лимит на пароль, не переживает
перезапуск и не шарится между воркерами; для масштаба этого self-host
приложения этого достаточно."""
import time
from collections import defaultdict

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

_WINDOW_SECONDS = 60
_MAX_REQUESTS_PER_WINDOW = 300
# SSE-канал — одно долгоживущее соединение, а не поток отдельных запросов, его
# не считаем
_EXEMPT_PATH_PREFIXES = ("/api/events",)

_requests: dict[str, list[float]] = defaultdict(list)


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.url.path.startswith(_EXEMPT_PATH_PREFIXES):
            return await call_next(request)

        client_ip = request.client.host if request.client else "unknown"
        now = time.monotonic()
        window = _requests[client_ip]
        window[:] = [t for t in window if now - t < _WINDOW_SECONDS]

        if len(window) >= _MAX_REQUESTS_PER_WINDOW:
            return JSONResponse(
                status_code=429,
                content={"detail": "Слишком много запросов. Попробуйте немного позже."},
            )

        window.append(now)
        return await call_next(request)
