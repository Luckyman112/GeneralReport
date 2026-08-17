"""Общая карта кампании ("Галактика") — весь JSON целиком видит любой
зарегистрированный пользователь; напрямую редактировать (двигать/добавлять
системы, менять любые данные и сохранять сразу) может только Ассистент+/
Куратор Ивентологии (AccessContext.can_decide_event); Ивентолог любой другой
ступени (AccessContext.is_event_submitter) не может сохранить правку сразу —
только предложить (galaxy_map_request_crud), а решает по заявке снова
Ассистент+/Куратор."""
import logging

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AccessContext, get_access_context
from app.crud import audit_log as audit_log_crud
from app.crud import galaxy_map as galaxy_map_crud
from app.crud import galaxy_map_request as galaxy_map_request_crud
from app.database import get_db
from app.exceptions import ForbiddenError, NotFoundError
from app.schemas.galaxy_map import (
    GalaxyMapRead,
    GalaxyMapRequestCreate,
    GalaxyMapRequestDecide,
    GalaxyMapRequestDetail,
    GalaxyMapRequestRead,
    GalaxyMapUpdate,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/galaxy-map", tags=["galaxy-map"])


@router.get("", response_model=GalaxyMapRead)
async def get_galaxy_map(
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> GalaxyMapRead:
    if not access.has_access:
        raise ForbiddenError("У вас нет доступа ни к одному формированию")
    row = await galaxy_map_crud.get(db)
    return GalaxyMapRead.model_validate(row)


@router.put("", response_model=GalaxyMapRead)
async def update_galaxy_map(
    payload: GalaxyMapUpdate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> GalaxyMapRead:
    """Прямое сохранение — двигать/добавлять системы и вообще сохранять любые
    правки сразу (без рассмотрения) может только Ассистент+/Куратор
    Ивентологии."""
    if not access.can_decide_event:
        raise ForbiddenError("Редактировать карту напрямую может только Ассистент+/Куратор Ивентологии")
    row = await galaxy_map_crud.replace(db, data=payload.data, updated_by_user_id=access.user.id)
    logger.info("%s сохранил карту кампании напрямую", access.user.username)
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="galaxy_map_update",
        details="Прямое сохранение карты кампании",
    )
    return GalaxyMapRead.model_validate(row)


@router.get("/requests", response_model=list[GalaxyMapRequestRead])
async def list_galaxy_map_requests(
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[GalaxyMapRequestRead]:
    """Очередь заявок на рассмотрение — видна только тем, кто их решает
    (Ассистент+/Куратор), обычный Ивентолог узнаёт об исходе своей заявки не
    отсюда (заявки без этого эндпоинта не перечисляются нигде — тонкий срез,
    достаточный для текущей задачи)."""
    if not access.can_decide_event:
        raise ForbiddenError("Доступно только Ассистенту+/Куратору Ивентологии")
    rows = await galaxy_map_request_crud.list_pending(db)
    return [GalaxyMapRequestRead.model_validate(r) for r in rows]


@router.post("/requests", response_model=GalaxyMapRequestDetail, status_code=201)
async def create_galaxy_map_request(
    payload: GalaxyMapRequestCreate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> GalaxyMapRequestDetail:
    if not access.is_event_submitter:
        raise ForbiddenError("Доступно только Ивентологам")
    row = await galaxy_map_request_crud.create(
        db, data=payload.data, note=(payload.note or "").strip() or None, submitted_by_user_id=access.user.id
    )
    logger.info("%s предложил правку карты кампании", access.user.username)
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="galaxy_map_request_create",
        details=f"Заявка на правку карты {row.id}",
    )
    return GalaxyMapRequestDetail.model_validate(row)


@router.post("/requests/{request_id}/decide", response_model=GalaxyMapRequestDetail)
async def decide_galaxy_map_request(
    request_id: str,
    payload: GalaxyMapRequestDecide,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> GalaxyMapRequestDetail:
    if not access.can_decide_event:
        raise ForbiddenError("Доступно только Ассистенту+/Куратору Ивентологии")
    request = await galaxy_map_request_crud.get_by_id(db, request_id)
    if request is None:
        raise NotFoundError("Заявка не найдена")
    reason = (payload.rejection_reason or "").strip() or None
    updated = await galaxy_map_request_crud.decide(
        db, request, approve=payload.approve, decided_by_user_id=access.user.id, rejection_reason=reason
    )
    if payload.approve:
        # Одобренная заявка целиком становится новой картой — тот же
        # replace(), что и у прямого сохранения (см. update_galaxy_map)
        await galaxy_map_crud.replace(db, data=updated.data, updated_by_user_id=access.user.id)
    logger.info(
        "%s %s заявку на правку карты %s",
        access.user.username,
        "одобрил" if payload.approve else "отклонил",
        request_id,
    )
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="galaxy_map_request_decide",
        details=f"{'Одобрил' if payload.approve else 'Отклонил'} заявку на правку карты {request_id}",
    )
    return GalaxyMapRequestDetail.model_validate(updated)
