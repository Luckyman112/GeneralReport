"""Модуль "Нарушители" — база нарушений устава. Заводить записи могут участники
формирований-"писателей" (по умолчанию никого, настраивается администратором),
просматривать — участники формирований-"читателей" плюс любой командир/заместитель
(нужно видеть нарушения своих бойцов). При подаче автоматически создаётся уведомление
для командного состава формирования нарушителя."""
import logging

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AccessContext, get_access_context
from app.core import discord_client
from app.crud import app_settings as app_settings_crud
from app.crud import notification as notification_crud
from app.crud import rank as rank_crud
from app.crud import regiment as regiment_crud
from app.crud import violation as violation_crud
from app.database import get_db
from app.exceptions import AppError, ForbiddenError, NotFoundError
from app.schemas.regiment_commander import GuildMemberRead
from app.schemas.violation import (
    ViolationCreate,
    ViolationRead,
    ViolationSettingsRead,
    ViolationSettingsUpdate,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/violations", tags=["violations"])


@router.get("/settings", response_model=ViolationSettingsRead)
async def get_violation_settings(
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> ViolationSettingsRead:
    """Список формирований-"писателей"/"читателей" — настраивает любой администратор."""
    if not access.is_admin:
        raise ForbiddenError("Только администратор может настраивать модуль «Нарушители»")
    row = await app_settings_crud.get(db)
    return ViolationSettingsRead.model_validate(row)


@router.patch("/settings", response_model=ViolationSettingsRead)
async def update_violation_settings(
    payload: ViolationSettingsUpdate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> ViolationSettingsRead:
    if not access.is_admin:
        raise ForbiddenError("Только администратор может настраивать модуль «Нарушители»")
    changes = payload.model_dump(exclude_unset=True)
    row = await app_settings_crud.update_violation_regiments(
        db,
        writer_regiment_ids=changes.get("writer_regiment_ids"),
        viewer_regiment_ids=changes.get("viewer_regiment_ids"),
    )
    logger.info("%s обновил настройки модуля «Нарушители»: %s", access.user.username, changes)
    return ViolationSettingsRead.model_validate(row)


@router.get("/target-candidates", response_model=list[GuildMemberRead])
async def get_target_candidates(
    access: AccessContext = Depends(get_access_context),
) -> list[GuildMemberRead]:
    """Полный список участников сервера — для выбора нарушителя при подаче записи."""
    if not access.can_write_violations:
        raise ForbiddenError("Заводить записи о нарушениях может только участник соответствующего формирования")

    members = await discord_client.fetch_guild_members()
    return [
        GuildMemberRead(
            discord_id=m["discord_id"],
            username=m["username"],
            discord_username=m["username"],
            avatar_url=m["avatar_url"],
        )
        for m in members
    ]


@router.get("", response_model=list[ViolationRead])
async def list_violations(
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[ViolationRead]:
    """Полный список видят администратор и участники формирований-"читателей"
    (например, вся Гвардия). Обычный командир/заместитель, не входящий в число
    "читателей", видит только нарушения бойцов СВОЕГО формирования."""
    if not access.can_view_violations:
        raise ForbiddenError("Нет доступа к списку нарушений")

    is_full_viewer = access.is_admin or bool(access.own_regiment_ids & access.violation_viewer_regiment_ids)
    if is_full_viewer:
        violations = await violation_crud.list_all(db)
    else:
        violations = await violation_crud.list_by_regiments(db, regiment_ids=access.commander_regiment_ids)

    return [ViolationRead.model_validate(v) for v in violations]


@router.post("", response_model=ViolationRead, status_code=201)
async def create_violation(
    payload: ViolationCreate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> ViolationRead:
    """Нарушитель либо выбирается из состава Discord-сервера, либо — если его там
    нет — вводится вручную (ИДН + звание + формирование + позывной)."""
    if not access.can_write_violations:
        raise ForbiddenError("Заводить записи о нарушениях может только участник соответствующего формирования")

    if payload.target_discord_id:
        members = await discord_client.fetch_guild_members()
        target = next((m for m in members if m["discord_id"] == payload.target_discord_id), None)
        if target is None:
            raise NotFoundError("Участник не найден на сервере")

        regiments = await regiment_crud.get_all(db)
        target_regiment = next((r for r in regiments if r.discord_role_id in target["roles"]), None)

        violation = await violation_crud.create(
            db,
            target_discord_id=target["discord_id"],
            target_username=target["username"],
            target_regiment_id=target_regiment.id if target_regiment else None,
            description=payload.description,
            created_by=access.user.id,
        )
        logger.info(
            "%s зафиксировал нарушение участника %s (%s)",
            access.user.username,
            target["username"],
            target["discord_id"],
        )
        notify_regiment_id = target_regiment.id if target_regiment else None
        notify_title = f"Новое нарушение: {target['username']}"
    else:
        if not (payload.target_service_id and payload.target_rank_id and payload.target_regiment_id and payload.target_callsign):
            raise AppError(
                "Нарушителя нет в Discord — укажите вручную ИДН, звание, формирование и позывной"
            )

        target_regiment = await regiment_crud.get_by_id(db, payload.target_regiment_id)
        if target_regiment is None:
            raise NotFoundError("Формирование не найдено")
        target_rank = await rank_crud.get_by_id(db, payload.target_rank_id)
        if target_rank is None:
            raise NotFoundError("Звание не найдено")

        violation = await violation_crud.create(
            db,
            target_discord_id=None,
            target_username=None,
            target_regiment_id=target_regiment.id,
            target_service_id=payload.target_service_id,
            target_rank_id=target_rank.id,
            target_callsign=payload.target_callsign,
            description=payload.description,
            created_by=access.user.id,
        )
        logger.info(
            "%s зафиксировал нарушение участника (вручную) %s %s %s",
            access.user.username,
            payload.target_service_id,
            target_rank.code,
            payload.target_callsign,
        )
        notify_regiment_id = target_regiment.id
        notify_title = f"Новое нарушение: {payload.target_service_id} {target_rank.code} {payload.target_callsign}"

    if notify_regiment_id is not None:
        await notification_crud.create_violation_notification(
            db,
            regiment_id=notify_regiment_id,
            violation_id=violation.id,
            title=notify_title,
            body=payload.description,
            created_by=access.user.id,
        )

    return ViolationRead.model_validate(violation)


@router.delete("/{violation_id}", status_code=204)
async def delete_violation(
    violation_id: int,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> None:
    if not access.is_admin:
        raise ForbiddenError("Удалять записи о нарушениях может только администратор")

    violation = await violation_crud.get_by_id(db, violation_id)
    if violation is None:
        raise NotFoundError("Запись не найдена")

    await violation_crud.delete(db, violation)
    logger.info("%s удалил запись о нарушении %s", access.user.username, violation_id)
