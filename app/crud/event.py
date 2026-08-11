from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.exceptions import AppError
from app.models.event import Event, EventMap, EventStatus
from app.models.user import User

_LOAD_OPTIONS = [
    selectinload(Event.submitted_by).selectinload(User.rank),
    selectinload(Event.decided_by).selectinload(User.rank),
]


async def list_all(db: AsyncSession, *, submitted_by_user_id: int | None = None) -> list[Event]:
    """submitted_by_user_id задан — только заявки этого пользователя (Ивентолог
    видит свои); не задан — все заявки (куратор/ассистент/админ видят очередь)."""
    query = select(Event).options(*_LOAD_OPTIONS).order_by(Event.created_at.desc())
    if submitted_by_user_id is not None:
        query = query.where(Event.submitted_by_user_id == submitted_by_user_id)
    result = await db.execute(query)
    return list(result.scalars().all())


async def get_by_id(db: AsyncSession, event_id: int) -> Event | None:
    # populate_existing=True обязателен: без него db.get() при уже загруженном
    # в сессию объекте вернёт его из identity map, проигнорировав selectinload
    # (см. тот же приём в app/crud/report.py::get_by_id)
    return await db.get(Event, event_id, options=_LOAD_OPTIONS, populate_existing=True)


async def create(db: AsyncSession, *, title: str, payload: dict, submitted_by_user_id: int) -> Event:
    row = Event(title=title, payload=payload, submitted_by_user_id=submitted_by_user_id)
    db.add(row)
    await db.commit()
    return await db.get(Event, row.id, options=_LOAD_OPTIONS, populate_existing=True)


async def update_content(db: AsyncSession, event: Event, *, title: str, payload: dict) -> Event:
    """Правка заявки — доступна автору и Ассистенту/Куратору, как пока заявка
    ожидает решения, так и уже после одобрения (см. app/api/event_room.py) —
    многое (например, командующего) узнают только по мере брифинга."""
    event.title = title
    event.payload = payload
    await db.commit()
    return await db.get(Event, event.id, options=_LOAD_OPTIONS, populate_existing=True)


async def decide(
    db: AsyncSession, event: Event, *, approve: bool, decided_by_user_id: int, rejection_reason: str | None = None
) -> Event:
    # Защита от повторного решения (двойной клик/повтор запроса) — без неё
    # повторное approve на уже одобренной заявке молча шлёт ЕЩЁ ОДНО сообщение
    # с пингом роли в Discord-канал каждый раз заново (баг-репорт: 7 пингов
    # всего сервера от одной и той же заявки) — тот же паттерн, что
    # promotion_crud.decide()
    if event.status != EventStatus.PENDING:
        raise AppError("Заявка уже решена — повторное решение по ней невозможно")
    event.status = EventStatus.APPROVED if approve else EventStatus.REJECTED
    event.decided_by_user_id = decided_by_user_id
    event.decided_at = datetime.now(timezone.utc)
    event.rejection_reason = rejection_reason
    await db.commit()
    return await db.get(Event, event.id, options=_LOAD_OPTIONS, populate_existing=True)


async def mark_notified(db: AsyncSession, event: Event, *, discord_message_id: str | None = None) -> None:
    event.notified_at = datetime.now(timezone.utc)
    if discord_message_id is not None:
        event.discord_message_id = discord_message_id
    await db.commit()


# --- Каталог карт -----------------------------------------------------------


async def list_maps(db: AsyncSession) -> list[EventMap]:
    result = await db.execute(select(EventMap).order_by(EventMap.name))
    return list(result.scalars().all())


async def create_map(
    db: AsyncSession,
    *,
    name: str,
    url: str | None = None,
    planet_name: str | None = None,
    landscape: str | None = None,
    weather: str | None = None,
    star_system: str | None = None,
) -> EventMap:
    row = EventMap(
        name=name,
        url=url,
        planet_name=planet_name,
        landscape=landscape,
        weather=weather,
        star_system=star_system,
    )
    db.add(row)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise AppError(f"Карта «{name}» уже есть в списке")
    await db.refresh(row)
    return row


async def update_map(db: AsyncSession, row: EventMap, **changes) -> EventMap:
    for key, value in changes.items():
        setattr(row, key, value)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise AppError(f"Карта «{changes.get('name', row.name)}» уже есть в списке")
    await db.refresh(row)
    return row


async def get_map_by_id(db: AsyncSession, map_id: int) -> EventMap | None:
    return await db.get(EventMap, map_id)


async def delete_map(db: AsyncSession, row: EventMap) -> None:
    await db.delete(row)
    await db.commit()
