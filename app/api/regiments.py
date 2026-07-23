"""Эндпоинты для просмотра и настройки формирований: роли, категории рапортов,
назначение командиров, состав участников."""
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AccessContext, get_access_context
from app.core import discord_client
from app.crud import app_settings as app_settings_crud
from app.crud import rank as rank_crud
from app.crud import regiment as regiment_crud
from app.crud import regiment_commander as regiment_commander_crud
from app.crud import report as report_crud
from app.crud import report_category as report_category_crud
from app.crud import user as user_crud
from app.database import get_db
from app.exceptions import ForbiddenError, NotFoundError
from app.models.user import User
from app.schemas.rank import RankRead
from app.schemas.regiment import DiscordRoleOption, RegimentCreate, RegimentRead, RegimentUpdate
from app.schemas.regiment_commander import (
    GuildMemberRead,
    MemberProfileUpdate,
    RegimentCommanderCreate,
    RegimentCommanderRead,
)
from app.schemas.report import ReportRead
from app.schemas.report_category import ReportCategoryCreate, ReportCategoryRead, ReportCategoryUpdate

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/regiments", tags=["regiments"])


def _require_regiment_access(access: AccessContext, regiment_id: int) -> None:
    if access.is_admin:
        return
    if regiment_id in access.commander_regiment_ids or regiment_id in access.soldier_regiment_ids:
        return
    raise ForbiddenError("Нет доступа к этому формированию")


async def _get_regiment_or_404(db: AsyncSession, regiment_id: int):
    regiment = await regiment_crud.get_by_id(db, regiment_id)
    if regiment is None:
        raise NotFoundError("Формирование не найдено")
    return regiment


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

    regiment = await regiment_crud.create(
        db, name=payload.name, discord_role_id=payload.discord_role_id, color=payload.color
    )
    logger.info("Администратор %s создал формирование %s", access.user.username, regiment.name)
    return RegimentRead.model_validate(regiment)


@router.patch("/{regiment_id}", response_model=RegimentRead)
async def update_regiment(
    regiment_id: int,
    payload: RegimentUpdate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> RegimentRead:
    """Переименование формирования, смена его роли и/или цвета — только администратор."""
    if not access.is_admin:
        raise ForbiddenError("Только администратор может изменять формирования")

    regiment = await _get_regiment_or_404(db, regiment_id)
    changes = payload.model_dump(exclude_unset=True)
    updated = await regiment_crud.update(db, regiment, **changes)
    logger.info("Администратор %s обновил формирование %s", access.user.username, updated.name)
    return RegimentRead.model_validate(updated)


# --- Категории рапортов -----------------------------------------------------------


@router.get("/{regiment_id}/categories", response_model=list[ReportCategoryRead])
async def list_categories(
    regiment_id: int,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[ReportCategoryRead]:
    """Категории рапортов формирования — доступно всем, у кого есть доступ к формированию."""
    _require_regiment_access(access, regiment_id)
    await _get_regiment_or_404(db, regiment_id)
    categories = await report_category_crud.get_by_regiment(db, regiment_id)
    return [ReportCategoryRead.model_validate(c) for c in categories]


@router.post("/{regiment_id}/categories", response_model=ReportCategoryRead, status_code=201)
async def create_category(
    regiment_id: int,
    payload: ReportCategoryCreate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> ReportCategoryRead:
    """Добавить категорию рапорта — командир этого формирования или администратор
    (заместитель категориями не управляет)."""
    if not access.can_manage_categories(regiment_id):
        raise ForbiddenError("Добавлять категории может только командир формирования")
    await _get_regiment_or_404(db, regiment_id)

    category = await report_category_crud.create(
        db,
        regiment_id=regiment_id,
        name=payload.name,
        fields=[f.model_dump() for f in payload.fields],
        points=payload.points,
    )
    logger.info("%s добавил категорию '%s' формированию %s", access.user.username, category.name, regiment_id)
    return ReportCategoryRead.model_validate(category)


@router.patch("/{regiment_id}/categories/{category_id}", response_model=ReportCategoryRead)
async def update_category(
    regiment_id: int,
    category_id: int,
    payload: ReportCategoryUpdate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> ReportCategoryRead:
    """Переименовать категорию и/или изменить список полей рапорта — командир этого
    формирования или администратор."""
    if not access.can_manage_categories(regiment_id):
        raise ForbiddenError("Изменять категории может только командир формирования")

    category = await report_category_crud.get_by_id(db, category_id)
    if category is None or category.regiment_id != regiment_id:
        raise NotFoundError("Категория не найдена")

    changes = payload.model_dump(exclude_unset=True)
    updated = await report_category_crud.update(db, category, **changes)
    return ReportCategoryRead.model_validate(updated)


@router.delete("/{regiment_id}/categories/{category_id}", status_code=204)
async def delete_category(
    regiment_id: int,
    category_id: int,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> None:
    """Удалить категорию рапорта — командир этого формирования или администратор
    (заместитель категориями не управляет)."""
    if not access.can_manage_categories(regiment_id):
        raise ForbiddenError("Удалять категории может только командир формирования")

    category = await report_category_crud.get_by_id(db, category_id)
    if category is None or category.regiment_id != regiment_id:
        raise NotFoundError("Категория не найдена")

    await report_category_crud.delete(db, category)


# --- Назначение командиров ---------------------------------------------------------


@router.get("/{regiment_id}/commander-candidates", response_model=list[GuildMemberRead])
async def get_commander_candidates(
    regiment_id: int,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[GuildMemberRead]:
    """Участники сервера с ролью "Командир" или "Заместитель" — кандидаты в
    командиры этого формирования. Только администратор."""
    if not access.is_admin:
        raise ForbiddenError("Только администратор может назначать командиров")

    app_config = await app_settings_crud.get(db)
    members = await discord_client.fetch_guild_members()
    candidates = [
        m
        for m in members
        if app_config.commander_role_id in m["roles"] or app_config.deputy_role_id in m["roles"]
    ]
    return [
        GuildMemberRead(
            discord_id=m["discord_id"],
            username=m["username"],
            discord_username=m["username"],
            avatar_url=m["avatar_url"],
            is_commander_role=app_config.commander_role_id in m["roles"],
            is_deputy_role=app_config.deputy_role_id in m["roles"],
        )
        for m in candidates
    ]


@router.get("/{regiment_id}/commanders", response_model=list[RegimentCommanderRead])
async def list_commanders(
    regiment_id: int,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[RegimentCommanderRead]:
    """Список уже назначенных командиров формирования."""
    _require_regiment_access(access, regiment_id)
    await _get_regiment_or_404(db, regiment_id)
    commanders = await regiment_commander_crud.get_by_regiment(db, regiment_id)
    return [RegimentCommanderRead.model_validate(c) for c in commanders]


@router.post("/{regiment_id}/commanders", response_model=RegimentCommanderRead, status_code=201)
async def add_commander(
    regiment_id: int,
    payload: RegimentCommanderCreate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> RegimentCommanderRead:
    """Назначить конкретного человека командиром этого формирования — только администратор."""
    if not access.is_admin:
        raise ForbiddenError("Только администратор может назначать командиров")
    await _get_regiment_or_404(db, regiment_id)

    commander = await regiment_commander_crud.add(
        db,
        regiment_id=regiment_id,
        discord_id=payload.discord_id,
        username=payload.username,
        role_type=payload.role_type,
    )
    logger.info(
        "Администратор %s назначил %s командиром формирования %s",
        access.user.username,
        payload.username,
        regiment_id,
    )
    return RegimentCommanderRead.model_validate(commander)


@router.delete("/{regiment_id}/commanders/{discord_id}", status_code=204)
async def remove_commander(
    regiment_id: int,
    discord_id: str,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> None:
    """Снять назначение командира — только администратор."""
    if not access.is_admin:
        raise ForbiddenError("Только администратор может снимать командиров")

    removed = await regiment_commander_crud.remove(db, regiment_id=regiment_id, discord_id=discord_id)
    if not removed:
        raise NotFoundError("Назначение не найдено")
    logger.info("Администратор %s снял командира %s с формирования %s", access.user.username, discord_id, regiment_id)


# --- Состав формирования (ростер) ---------------------------------------------------


def _build_guild_member(member: dict, user: User | None) -> GuildMemberRead:
    days_in_rank = None
    if user is not None and user.rank_assigned_at is not None:
        days_in_rank = (datetime.now(timezone.utc) - user.rank_assigned_at).days

    return GuildMemberRead(
        discord_id=member["discord_id"],
        username=(user.nickname_override if user and user.nickname_override else member["username"]),
        discord_username=member["username"],
        avatar_url=member["avatar_url"],
        service_id=user.service_id if user else None,
        callsign=user.callsign if user else None,
        rank=RankRead.model_validate(user.rank) if user and user.rank else None,
        days_in_rank=days_in_rank,
        is_inactive=user.is_inactive if user else False,
    )


@router.get("/{regiment_id}/members", response_model=list[GuildMemberRead])
async def get_members(
    regiment_id: int,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[GuildMemberRead]:
    """Список участников сервера, состоящих в этом формировании — виден бойцам,
    командирам и администратору этого формирования. Ник переопределяется веб-ником,
    если командир его задал (см. PATCH .../members/{discord_id}/nickname)."""
    _require_regiment_access(access, regiment_id)
    regiment = await _get_regiment_or_404(db, regiment_id)

    members = await discord_client.fetch_guild_members()
    roster = [m for m in members if regiment.discord_role_id in m["roles"]]

    users_by_discord_id = {
        u.discord_id: u
        for u in await user_crud.get_by_discord_ids(db, [m["discord_id"] for m in roster])
    }

    return [_build_guild_member(m, users_by_discord_id.get(m["discord_id"])) for m in roster]


@router.patch("/{regiment_id}/members/{discord_id}/profile", response_model=GuildMemberRead)
async def update_member_profile(
    regiment_id: int,
    discord_id: str,
    payload: MemberProfileUpdate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> GuildMemberRead:
    """Единая форма профиля участника формирования — веб-ник, ИДН, звание, позывной,
    отметка неактивности. Доступно командиру или заместителю (это работа с личным
    составом, а не управление категориями, которое заместителю недоступно)."""
    if not access.is_commander_of(regiment_id):
        raise ForbiddenError("Менять профиль участника может только командир формирования")
    regiment = await _get_regiment_or_404(db, regiment_id)

    members = await discord_client.fetch_guild_members()
    member = next((m for m in members if m["discord_id"] == discord_id), None)
    if member is None or regiment.discord_role_id not in member["roles"]:
        raise NotFoundError("Участник не найден в этом формировании")

    changes = payload.model_dump(exclude_unset=True)
    if "nickname" in changes:
        changes["nickname_override"] = changes.pop("nickname") or None
    if "rank_id" in changes and changes["rank_id"] is not None:
        rank = await rank_crud.get_by_id(db, changes["rank_id"])
        if rank is None:
            raise NotFoundError("Звание не найдено")

    user = await user_crud.update_profile(
        db, discord_id=discord_id, fallback_username=member["username"], changes=changes
    )
    logger.info("%s обновил профиль участника %s: %s", access.user.username, discord_id, changes)
    return _build_guild_member(member, user)


@router.get("/{regiment_id}/members/{discord_id}/reports", response_model=list[ReportRead])
async def get_member_reports(
    regiment_id: int,
    discord_id: str,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[ReportRead]:
    """Все рапорты конкретного участника в этом формировании — виден любому, у кого
    есть доступ к этому формированию (боец, командир, администратор)."""
    _require_regiment_access(access, regiment_id)
    await _get_regiment_or_404(db, regiment_id)

    user = await user_crud.get_by_discord_id(db, discord_id)
    if user is None:
        return []

    reports = await report_crud.list_reports(db, regiment_ids=[regiment_id], user_id=user.id)
    return [ReportRead.model_validate(r) for r in reports]
