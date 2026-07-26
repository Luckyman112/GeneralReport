"""Регистрация нового бойца: при первом входе указывает ИДН и позывной (звание
всегда стартовое — рекрут), затем заявку одобряет или отклоняет заместитель/
командир формирования, к которому у бойца есть Discord-роль. Пока заявка не
одобрена (или отклонена), боец не может подавать и видеть рапорты, даже имея роль
формирования — это форсирует прохождение регистрации до реального доступа."""
import logging

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AccessContext, get_access_context
from app.core.events import event_bus
from app.crud import notification as notification_crud
from app.crud import rank as rank_crud
from app.crud import regiment as regiment_crud
from app.crud import user as user_crud
from app.database import get_db
from app.exceptions import AppError, ForbiddenError, NotFoundError
from app.schemas.registration import PendingRegistrationRead, RegistrationSubmit
from app.schemas.user import UserRead

logger = logging.getLogger(__name__)

router = APIRouter(tags=["registration"])

STARTING_RANK_CODE = "RCT"


async def _regiments_for_user(db: AsyncSession, user) -> list:
    regiments = await regiment_crud.get_all(db)
    role_ids = set(user.roles)
    return [r for r in regiments if r.discord_role_id in role_ids]


@router.post("/me/registration", response_model=UserRead)
async def submit_registration(
    payload: RegistrationSubmit,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> UserRead:
    if access.user.registration_status == "approved":
        raise AppError("Регистрация уже пройдена")

    starting_rank = await rank_crud.get_by_code(db, STARTING_RANK_CODE)
    if starting_rank is None:
        raise AppError("Стартовое звание (RCT) не настроено — обратитесь к администратору")

    user = await user_crud.update_profile(
        db,
        discord_id=access.user.discord_id,
        fallback_username=access.user.username,
        changes={
            "service_id": payload.service_id.strip(),
            "callsign": payload.callsign.strip(),
            "steam_id": payload.steam_id.strip(),
            "nickname_override": payload.callsign.strip(),
            "rank_id": starting_rank.id,
            "registration_status": "pending",
        },
    )
    logger.info("Пользователь %s подал заявку на регистрацию", user.username)

    regiments = await _regiments_for_user(db, user)
    if regiments:
        from app.crud import regiment_commander as regiment_commander_crud

        notified: set[int] = set()
        for regiment in regiments:
            commanders = await regiment_commander_crud.get_by_regiment(db, regiment.id)
            for commander in commanders:
                target = await user_crud.get_by_discord_id(db, commander.discord_id)
                if target is None or target.id in notified:
                    continue
                notified.add(target.id)
                await notification_crud.create_personal_notification(
                    db,
                    target_user_id=target.id,
                    title="Новая заявка на регистрацию",
                    body=f"{user.username} ({regiment.name}) ждёт одобрения регистрации.",
                    created_by=user.id,
                )

    event_bus.publish("registrations")
    return UserRead.model_validate(user)


@router.get("/registrations/pending", response_model=list[PendingRegistrationRead])
async def list_pending_registrations(
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[PendingRegistrationRead]:
    pending_users = await user_crud.list_pending_registrations(db)
    regiments = await regiment_crud.get_all(db)

    result: list[PendingRegistrationRead] = []
    for user in pending_users:
        user_regiments = [r for r in regiments if r.discord_role_id in set(user.roles)]
        if not (
            access.is_admin
            or access.is_high_command
            or any(access.is_commander_of(r.id) for r in user_regiments)
        ):
            continue
        result.append(
            PendingRegistrationRead(
                discord_id=user.discord_id,
                username=user.username,
                avatar_url=user.avatar_url,
                service_id=user.service_id,
                callsign=user.callsign,
                steam_id=user.steam_id,
                created_at=user.created_at,
                regiment_names=[r.name for r in user_regiments],
            )
        )
    return result


async def _require_reviewer_access(db: AsyncSession, access: AccessContext, target_user) -> None:
    user_regiments = await _regiments_for_user(db, target_user)
    if access.is_admin or access.is_high_command:
        return
    if any(access.is_commander_of(r.id) for r in user_regiments):
        return
    raise ForbiddenError("Одобрять регистрацию может только заместитель/командир формирования этого бойца")


@router.post("/registrations/{discord_id}/approve", response_model=UserRead)
async def approve_registration(
    discord_id: str,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> UserRead:
    target = await user_crud.get_by_discord_id(db, discord_id)
    if target is None:
        raise NotFoundError("Заявка не найдена")
    await _require_reviewer_access(db, access, target)

    user = await user_crud.update_profile(
        db, discord_id=discord_id, fallback_username=target.username, changes={"registration_status": "approved"}
    )
    logger.info("%s одобрил регистрацию %s", access.user.username, discord_id)
    await notification_crud.create_personal_notification(
        db,
        target_user_id=user.id,
        title="Регистрация одобрена",
        body="Ваша регистрация одобрена — доступ к рапортам открыт.",
        created_by=access.user.id,
    )
    event_bus.publish("registrations")
    return UserRead.model_validate(user)


@router.post("/registrations/{discord_id}/reject", response_model=UserRead)
async def reject_registration(
    discord_id: str,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> UserRead:
    target = await user_crud.get_by_discord_id(db, discord_id)
    if target is None:
        raise NotFoundError("Заявка не найдена")
    await _require_reviewer_access(db, access, target)

    user = await user_crud.update_profile(
        db,
        discord_id=discord_id,
        fallback_username=target.username,
        changes={
            "registration_status": "rejected",
            "service_id": None,
            "callsign": None,
            "steam_id": None,
            "nickname_override": None,
        },
    )
    logger.info("%s отклонил регистрацию %s", access.user.username, discord_id)
    await notification_crud.create_personal_notification(
        db,
        target_user_id=user.id,
        title="Регистрация отклонена",
        body="Ваша заявка на регистрацию отклонена — заполните форму заново.",
        created_by=access.user.id,
    )
    event_bus.publish("registrations")
    return UserRead.model_validate(user)
