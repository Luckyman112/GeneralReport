"""Лёгкая шина событий в рамках одного процесса — для push-обновлений на фронт
через SSE (см. app/api/events.py), чтобы не поллить API каждые N секунд с каждой
открытой вкладки. Работает только в пределах одного процесса/воркера (для
масштаба этого self-host приложения этого достаточно)."""
import asyncio


class EventBus:
    def __init__(self) -> None:
        self._subscribers: list[asyncio.Queue] = []

    def subscribe(self) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue()
        self._subscribers.append(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        if queue in self._subscribers:
            self._subscribers.remove(queue)

    def publish(self, event_type: str) -> None:
        for queue in self._subscribers:
            queue.put_nowait(event_type)


event_bus = EventBus()
