from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.galaxy_map import GalaxyMap

_SINGLETON_ID = 1
_EMPTY_DATA: dict = {}


async def get(db: AsyncSession) -> GalaxyMap:
    """Singleton-строка, как app_settings_crud.get() — создаёт пустую запись
    при первом обращении, если карту ещё никто не сохранял."""
    row = await db.get(GalaxyMap, _SINGLETON_ID, populate_existing=True)
    if row is None:
        row = GalaxyMap(id=_SINGLETON_ID, data=_EMPTY_DATA)
        db.add(row)
        await db.commit()
        row = await db.get(GalaxyMap, _SINGLETON_ID, populate_existing=True)
    return row


async def replace(db: AsyncSession, *, data: dict, updated_by_user_id: int) -> GalaxyMap:
    """Прямая перезапись всей карты — только для того, у кого
    can_decide_event (см. app/api/galaxy_map.py) — тот же способ, которым
    одобренная заявка (galaxy_map_request_crud.decide) применяет свои данные."""
    row = await get(db)
    row.data = data
    row.updated_at = datetime.now(timezone.utc)
    row.updated_by_user_id = updated_by_user_id
    await db.commit()
    return await db.get(GalaxyMap, _SINGLETON_ID, populate_existing=True)
