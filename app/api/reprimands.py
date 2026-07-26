"""Выговоры — выдаёт командир/заместитель своим бойцам, высшее командование и
администратор — кому угодно, включая командиров других формирований. Устный
выговор ничего не ограничивает сам по себе; строгий — блокирует автоматическое
повышение. Второй одновременно активный устный автоматически создаёт строгий.
Снять может тот же круг лиц, либо сам боец — если набрал нужное количество
баллов после выдачи (см. self_revoke_reprimand)."""
import logging

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AccessContext, get_access_context
from app.core import discord_client
from app.crud import audit_log as audit_log_crud
from app.crud import regiment as regiment_crud
from app.crud import regiment_commander as regiment_commander_crud
from app.crud import reprimand as reprimand_crud
from app.crud import user as user_crud
from app.database import get_db
from app.exceptions import AppError, ForbiddenError, NotFoundError
from app.models.reprimand import Reprimand
from app.schemas.reprimand import ReprimandAppealUpdate, ReprimandCreate, ReprimandRead

logger = logging.getLogger(__name__)

router = APIRouter(tags=["reprimands"])
regiment_router = APIRouter(prefix="/regiments/{regiment_id}/reprimands", tags=["reprimands"])


async def _is_commander_anywhere(db: AsyncSession, discord_id: str) -> bool:
    assignments = await regiment_commander_crud.get_all(db)
    return any(rc.discord_id == discord_id for rc in assignments)


async def _to_read(db: AsyncSession, reprimand: Reprimand) -> ReprimandRead:
    points_earned = await reprimand_crud.points_earned_since(
        db, user_id=reprimand.target_user_id, since=reprimand.issued_at
    )
    return ReprimandRead(
        id=reprimand.id,
        regiment_id=reprimand.regiment_id,
        reason=reprimand.reason,
        severity=reprimand.severity,
        points_required=reprimand.points_required,
        auto_escalated=reprimand.auto_escalated,
        issued_at=reprimand.issued_at,
        revoked_at=reprimand.revoked_at,
        target=reprimand.target,
        issuer=reprimand.issuer,
        points_earned=points_earned,
        appeal_text=reprimand.appeal_text,
    )


@router.get("/reprimands", response_model=list[ReprimandRead])
async def list_visible_reprimands(
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[ReprimandRead]:
    """Отдельная страница "Выговоры" — видимость такая же, как у нарушений: всё —
    админу/высшему командованию, по формированию — командиру/заместителю, только
    свои — обычному бойцу."""
    if access.is_admin or access.is_high_command:
        reprimands = await reprimand_crud.list_all(db)
    elif access.commander_regiment_ids:
        reprimands = await reprimand_crud.list_by_regiments(db, regiment_ids=access.commander_regiment_ids)
    else:
        reprimands = await reprimand_crud.list_by_target_user(db, user_id=access.user.id)

    return [await _to_read(db, r) for r in reprimands]


@router.post("/reprimands/{reprimand_id}/self-revoke", response_model=ReprimandRead)
async def self_revoke_reprimand(
    reprimand_id: int,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> ReprimandRead:
    """Боец может снять СВОЙ выговор сам, если набрал достаточно баллов (за
    одобренные рапорты) с момента выдачи."""
    reprimand = await reprimand_crud.get_by_id(db, reprimand_id)
    if reprimand is None:
        raise NotFoundError("Выговор не найден")
    if reprimand.target_user_id != access.user.id:
        raise ForbiddenError("Снять можно только свой собственный выговор")
    if reprimand.revoked_at is not None:
        raise AppError("Выговор уже снят")

    points_earned = await reprimand_crud.points_earned_since(
        db, user_id=access.user.id, since=reprimand.issued_at
    )
    if points_earned < reprimand.points_required:
        raise ForbiddenError(
            f"Недостаточно баллов для снятия: набрано {points_earned} из {reprimand.points_required}"
        )

    updated = await reprimand_crud.revoke(db, reprimand, revoked_by=access.user.id)
    logger.info("%s самостоятельно снял выговор %s", access.user.username, reprimand_id)
    return await _to_read(db, updated)


@router.patch("/reprimands/{reprimand_id}/appeal", response_model=ReprimandRead)
async def set_reprimand_appeal(
    reprimand_id: int,
    payload: ReprimandAppealUpdate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> ReprimandRead:
    """Пояснение/апелляция — видно всем, кто видит сам выговор. Оставить/отредактировать
    может либо сам боец (о ком выговор), либо заместитель/командир его формирования,
    высшее командование или администратор ("зам+")."""
    reprimand = await reprimand_crud.get_by_id(db, reprimand_id)
    if reprimand is None:
        raise NotFoundError("Выговор не найден")

    is_target = reprimand.target_user_id == access.user.id
    if not is_target:
        target_is_commander = await _is_commander_anywhere(db, reprimand.target.discord_id)
        if not access.can_reprimand(reprimand.regiment_id, target_is_commander=target_is_commander):
            raise ForbiddenError("Оставить пояснение может только сам боец или заместитель/командир формирования")

    updated = await reprimand_crud.set_appeal(db, reprimand, appeal_text=payload.appeal_text)
    return await _to_read(db, updated)


@regiment_router.get("", response_model=list[ReprimandRead])
async def list_reprimands(
    regiment_id: int,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[ReprimandRead]:
    if not access.is_commander_of(regiment_id):
        raise ForbiddenError("Смотреть выговоры может только командир формирования")
    reprimands = await reprimand_crud.list_for_regiment(db, regiment_id=regiment_id)
    return [await _to_read(db, r) for r in reprimands]


@regiment_router.post("", response_model=ReprimandRead, status_code=201)
async def issue_reprimand(
    regiment_id: int,
    payload: ReprimandCreate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> ReprimandRead:
    regiment = await regiment_crud.get_by_id(db, regiment_id)
    if regiment is None:
        raise NotFoundError("Формирование не найдено")

    members = await discord_client.fetch_guild_members()
    target = next((m for m in members if m["discord_id"] == payload.target_discord_id), None)
    if target is None:
        raise NotFoundError("Участник не найден на сервере")

    target_is_commander = await _is_commander_anywhere(db, payload.target_discord_id)
    if not access.can_reprimand(regiment_id, target_is_commander=target_is_commander):
        raise ForbiddenError(
            "Выговор командиру/заместителю может выдать только высшее командование или администратор"
        )

    target_user = await user_crud.get_by_discord_id(db, payload.target_discord_id)
    if target_user is None:
        target_user = await user_crud.update_profile(
            db, discord_id=payload.target_discord_id, fallback_username=target["username"], changes={}
        )

    reprimand = await reprimand_crud.create(
        db,
        target_user_id=target_user.id,
        regiment_id=regiment_id,
        reason=payload.reason,
        issued_by=access.user.id,
        severity=payload.severity,
        points_required=payload.points_required,
    )
    logger.info(
        "%s выдал %s выговор участнику %s: %s",
        access.user.username,
        payload.severity,
        target["username"],
        payload.reason,
    )
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        action="reprimand_issue",
        details=f"Выдал {payload.severity} выговор {target['username']} ({payload.reason})",
    )
    return await _to_read(db, reprimand)


@regiment_router.delete("/{reprimand_id}", status_code=204)
async def revoke_reprimand(
    regiment_id: int,
    reprimand_id: int,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> None:
    reprimand = await reprimand_crud.get_by_id(db, reprimand_id)
    if reprimand is None or reprimand.regiment_id != regiment_id:
        raise NotFoundError("Выговор не найден")

    target_is_commander = await _is_commander_anywhere(db, reprimand.target.discord_id)
    if not access.can_reprimand(regiment_id, target_is_commander=target_is_commander):
        raise ForbiddenError("Нет прав на снятие этого выговора")

    await reprimand_crud.revoke(db, reprimand, revoked_by=access.user.id)
    logger.info("%s снял выговор %s", access.user.username, reprimand_id)
    await audit_log_crud.log(
        db, actor_user_id=access.user.id, action="reprimand_revoke", details=f"Снял выговор #{reprimand_id}"
    )
