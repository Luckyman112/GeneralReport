"""Розыск — публичный список (виден любому авторизованному бойцу, в отличие от
"Нарушители"), заводить/снимать может тот же круг лиц, что подаёт рапорт о
задержании (см. AccessContext.can_file_detention_report)."""
import logging

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AccessContext, get_access_context
from app.core.events import event_bus
from app.crud import audit_log as audit_log_crud
from app.crud import wanted as wanted_crud
from app.database import get_db
from app.exceptions import ForbiddenError, NotFoundError
from app.schemas.wanted import WantedEntryCreate, WantedEntryRead, WantedResolveRequest

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/wanted", tags=["wanted"])


@router.get("", response_model=list[WantedEntryRead])
async def list_wanted(
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[WantedEntryRead]:
    entries = await wanted_crud.list_all(db)
    return [WantedEntryRead.model_validate(e) for e in entries]


@router.post("", response_model=WantedEntryRead, status_code=201)
async def create_wanted(
    payload: WantedEntryCreate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> WantedEntryRead:
    if not access.can_file_detention_report:
        raise ForbiddenError("Заводить розыск может тот же, кто подаёт рапорт о задержании")

    entry = await wanted_crud.create(
        db,
        nickname=payload.nickname.strip(),
        service_id=(payload.service_id or "").strip() or None,
        rank_id=payload.rank_id,
        regiment_id=payload.regiment_id,
        reason=payload.reason.strip(),
        created_by=access.user.id,
    )
    logger.info("%s объявил в розыск «%s»", access.user.username, entry.nickname)
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="wanted_create",
        details=f"Объявил в розыск «{entry.nickname}» (#{entry.id}): {entry.reason}",
    )
    event_bus.publish("wanted")
    return WantedEntryRead.model_validate(entry)


@router.post("/{entry_id}/resolve", response_model=WantedEntryRead)
async def resolve_wanted(
    entry_id: int,
    payload: WantedResolveRequest,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> WantedEntryRead:
    if not access.can_file_detention_report:
        raise ForbiddenError("Снять с розыска может тот же, кто подаёт рапорт о задержании")

    entry = await wanted_crud.get_by_id(db, entry_id)
    if entry is None:
        raise NotFoundError("Запись не найдена")
    if entry.status == "resolved":
        raise ForbiddenError("Уже снят с розыска")

    updated = await wanted_crud.resolve(db, entry, resolution=payload.resolution, resolved_by=access.user.id)
    logger.info("%s снял с розыска «%s» (%s)", access.user.username, updated.nickname, payload.resolution)
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="wanted_resolve",
        details=f"Снял с розыска «{updated.nickname}» (#{updated.id}): {payload.resolution}",
    )
    event_bus.publish("wanted")
    return WantedEntryRead.model_validate(updated)


@router.delete("/{entry_id}", status_code=204)
async def delete_wanted(
    entry_id: int,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> None:
    if not access.is_admin:
        raise ForbiddenError("Удалять записи розыска может только администратор")

    entry = await wanted_crud.get_by_id(db, entry_id)
    if entry is None:
        raise NotFoundError("Запись не найдена")

    await wanted_crud.delete(db, entry)
    logger.info("%s удалил запись розыска «%s»", access.user.username, entry.nickname)
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="wanted_delete",
        details=f"Удалил запись розыска «{entry.nickname}» (#{entry_id})",
    )
    event_bus.publish("wanted")
