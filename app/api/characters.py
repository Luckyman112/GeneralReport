"""Дополнительные персонажи (второй игровой персонаж / джедаи, приписанные
сразу к нескольким формированиям) — заводятся и настраиваются полностью
вручную администратором, без самостоятельной регистрации."""
import logging

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AccessContext, get_access_context
from app.crud import character as character_crud
from app.crud import rank as rank_crud
from app.crud import user as user_crud
from app.database import get_db
from app.exceptions import AppError, ForbiddenError, NotFoundError
from app.schemas.character import CharacterCreate, CharacterRead, CharacterUpdate

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/users/{discord_id}/characters", tags=["characters"])


def _require_admin(access: AccessContext) -> None:
    if not access.is_admin:
        raise ForbiddenError("Персонажами может управлять только администратор")


async def _validate_rank_is_jedi(db: AsyncSession, *, rank_id: int | None, is_jedi: bool) -> None:
    if rank_id is None:
        return
    rank = await rank_crud.get_by_id(db, rank_id)
    if rank is None:
        raise NotFoundError("Звание не найдено")
    if is_jedi and not rank.tier.is_jedi:
        raise AppError("Джедаю можно назначить только джедайское звание")
    if not is_jedi and rank.tier.is_jedi:
        raise AppError("Обычному персонажу нельзя назначить джедайское звание")


@router.get("", response_model=list[CharacterRead])
async def list_characters(
    discord_id: str, db: AsyncSession = Depends(get_db), access: AccessContext = Depends(get_access_context)
) -> list[CharacterRead]:
    _require_admin(access)
    target = await user_crud.get_by_discord_id(db, discord_id)
    if target is None:
        raise NotFoundError("Пользователь не найден")
    characters = await character_crud.list_for_user(db, user_id=target.id)
    return [CharacterRead.model_validate(c) for c in characters]


@router.post("", response_model=CharacterRead, status_code=201)
async def create_character(
    discord_id: str,
    payload: CharacterCreate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> CharacterRead:
    _require_admin(access)
    target = await user_crud.get_by_discord_id(db, discord_id)
    if target is None:
        raise NotFoundError("Пользователь не найден")
    await _validate_rank_is_jedi(db, rank_id=payload.rank_id, is_jedi=payload.is_jedi)
    character = await character_crud.create(
        db,
        user_id=target.id,
        regiment_id=payload.regiment_id,
        created_by_user_id=access.user.id,
        service_id=payload.service_id,
        callsign=payload.callsign,
        rank_id=payload.rank_id,
        steam_id=payload.steam_id,
        is_jedi=payload.is_jedi,
    )
    logger.info(
        "%s завёл персонажа для %s в формировании %s", access.user.username, discord_id, payload.regiment_id
    )
    return CharacterRead.model_validate(character)


@router.patch("/{character_id}", response_model=CharacterRead)
async def update_character(
    discord_id: str,
    character_id: int,
    payload: CharacterUpdate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> CharacterRead:
    _require_admin(access)
    character = await character_crud.get_by_id(db, character_id)
    target = await user_crud.get_by_discord_id(db, discord_id)
    if character is None or target is None or character.user_id != target.id:
        raise NotFoundError("Персонаж не найден")

    changes = payload.model_dump(exclude_unset=True)
    is_jedi = changes.get("is_jedi", character.is_jedi)
    rank_id = changes.get("rank_id", character.rank_id)
    if "rank_id" in changes or "is_jedi" in changes:
        await _validate_rank_is_jedi(db, rank_id=rank_id, is_jedi=is_jedi)
    updated = await character_crud.update(db, character, **changes)
    logger.info("%s изменил персонажа #%s пользователя %s", access.user.username, character_id, discord_id)
    return CharacterRead.model_validate(updated)


@router.delete("/{character_id}", status_code=204)
async def delete_character(
    discord_id: str,
    character_id: int,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> None:
    _require_admin(access)
    character = await character_crud.get_by_id(db, character_id)
    target = await user_crud.get_by_discord_id(db, discord_id)
    if character is None or target is None or character.user_id != target.id:
        raise NotFoundError("Персонаж не найден")
    await character_crud.delete(db, character)
    logger.info("%s удалил персонажа #%s пользователя %s", access.user.username, character_id, discord_id)
