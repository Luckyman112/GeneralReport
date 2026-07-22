"""Эндпоинты для просмотра и настройки формирований."""
import logging

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AccessContext, get_access_context
from app.core import discord_client
from app.crud import regiment as regiment_crud
from app.database import get_db
from app.exceptions import ForbiddenError, NotFoundError
from app.schemas.regiment import DiscordRoleOption, RegimentCreate, RegimentRead, RegimentUpdate

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/regiments", tags=["regiments"])


@router.get("", response_model=list[RegimentRead])
async def list_regiments(
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[RegimentRead]:
    """Список формирований — виден всем авторизованным пользователям (нужен для формы рапорта)."""
    regiments = await regiment_crud.get_all(db)
    return [RegimentRead.model_validate(r) for r in regiments]


@router.get("/discord-roles", response_model=list[DiscordRoleOption])
async def get_discord_roles(access: AccessContext = Depends(get_access_context)) -> list[DiscordRoleOption]:
    """Список ролей единственного Discord-сервера — для выбора роли формирования в веб-панели."""
    if not access.is_admin:
        raise ForbiddenError("Только администратор может настраивать формирования")

    roles = await discord_client.fetch_guild_roles()
    return [DiscordRoleOption(**role) for role in roles]


@router.post("", response_model=RegimentRead, status_code=201)
async def create_regiment(
    payload: RegimentCreate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> RegimentRead:
    """Создание формирования: название + роль на едином Discord-сервере — только администратор."""
    if not access.is_admin:
        raise ForbiddenError("Только администратор может создавать формирования")

    regiment = await regiment_crud.create(db, name=payload.name, discord_role_id=payload.discord_role_id)
    logger.info("Администратор %s создал формирование %s", access.user.username, regiment.name)
    return RegimentRead.model_validate(regiment)


@router.patch("/{regiment_id}", response_model=RegimentRead)
async def update_regiment(
    regiment_id: int,
    payload: RegimentUpdate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> RegimentRead:
    """Переименование формирования и/или смена его роли — только администратор."""
    if not access.is_admin:
        raise ForbiddenError("Только администратор может изменять формирования")

    regiment = await regiment_crud.get_by_id(db, regiment_id)
    if regiment is None:
        raise NotFoundError("Формирование не найдено")

    updated = await regiment_crud.update(
        db, regiment, name=payload.name, discord_role_id=payload.discord_role_id
    )
    logger.info("Администратор %s обновил формирование %s", access.user.username, updated.name)
    return RegimentRead.model_validate(updated)
