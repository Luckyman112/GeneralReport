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
# 600, а не 300: одна страница делает 10–20 запросов, а за одним IP бывает
# несколько игроков (общий NAT)
_MAX_REQUESTS_PER_WINDOW = 600
# SSE-канал — одно долгоживущее соединение, а не поток отдельных запросов, его
# не считаем
_EXEMPT_PATH_PREFIXES = ("/api/events",)
# лимит — только на API и вход: статика (JS-чанки страниц, модели и текстуры
# карты галактики) раньше тоже считалась, и быстрый переход по разделам ловил
# 429 на JS-чанке — страница не открывалась вовсе
_LIMITED_PATH_PREFIXES = ("/api/", "/auth/")
# раз в столько запросов подчищаем IP, чьё окно полностью опустело — иначе
# _requests растёт без ограничения весь срок жизни процесса за счёт адресов,
# которые больше никогда не вернутся (self-host без перезапуска неделями)
_SWEEP_EVERY_N_REQUESTS = 1000

_requests: dict[str, list[float]] = defaultdict(list)


def client_ip(request: Request) -> str:
    """Настоящий адрес клиента. Сайт стоит за Cloudflare Tunnel: для приложения
    каждый запрос приходит от cloudflared, и request.client.host у всех
    пользователей один и тот же — общий лимит на весь сайт. Cloudflare кладёт
    адрес посетителя в CF-Connecting-IP (и перезаписывает его, если клиент
    прислал свой), поэтому берём его, а без него — адрес соединения (локальный
    доступ, Zabbix)."""
    cf = request.headers.get("cf-connecting-ip")
    if cf:
        return cf.strip()
    return request.client.host if request.client else "unknown"
_request_counter = 0


def _sweep_stale_entries(now: float) -> None:
    stale_ips = [
        ip
        for ip, window in _requests.items()
        if not [t for t in window if now - t < _WINDOW_SECONDS]
    ]
    for ip in stale_ips:
        del _requests[ip]


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if not path.startswith(_LIMITED_PATH_PREFIXES) or path.startswith(_EXEMPT_PATH_PREFIXES):
            return await call_next(request)

        global _request_counter

        now = time.monotonic()
        window = _requests[client_ip(request)]
        window[:] = [t for t in window if now - t < _WINDOW_SECONDS]

        if len(window) >= _MAX_REQUESTS_PER_WINDOW:
            return JSONResponse(
                status_code=429,
                content={"detail": "Слишком много запросов. Попробуйте немного позже."},
            )

        window.append(now)

        _request_counter += 1
        if _request_counter % _SWEEP_EVERY_N_REQUESTS == 0:
            _sweep_stale_entries(now)

        return await call_next(request)
