"""Эндпоинты для просмотра и настройки формирований: роли, категории рапортов,
назначение командиров, состав участников."""
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AccessContext, get_access_context
from app.core import discord_client
from app.core.uploads import read_image_upload
from app.crud import app_settings as app_settings_crud
from app.crud import audit_log as audit_log_crud
from app.crud import character as character_crud
from app.crud import jedi_trial as jedi_trial_crud
from app.crud import points_adjustment as points_adjustment_crud
from app.crud import promotion as promotion_crud
from app.crud import rank as rank_crud
from app.crud import regiment as regiment_crud
from app.crud import regiment_commander as regiment_commander_crud
from app.crud import report as report_crud
from app.crud import report_category as report_category_crud
from app.crud import report_participant as report_participant_crud
from app.crud import specialization as specialization_crud
from app.crud import squad as squad_crud
from app.crud import user as user_crud
from app.database import get_db
from app.exceptions import AppError, ForbiddenError, NotFoundError
from app.models.character import Character
from app.models.report import ReportStatus
from app.models.specialization import DISCIPLINE_CATEGORIES
from app.models.squad import DEFAULT_SQUAD_TIER_LABELS
from app.models.user import JEDI_COUNCIL_SEATS, User

_PHOTO_UPLOAD_ROOT = Path(__file__).resolve().parent.parent.parent / "uploads" / "members"
_ALLOWED_PHOTO_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
_MAX_PHOTO_SIZE = 5 * 1024 * 1024  # 5 МБ
from app.schemas.audit_log import AuditLogRead
from app.schemas.jedi_trial import JediTrialProgressRead, JediTrialRead
from app.schemas.promotion import PointsAdjustmentRead
from app.schemas.rank import RankRead
from app.schemas.regiment import DiscordRoleOption, RegimentCreate, RegimentRead, RegimentUpdate
from app.schemas.regiment_commander import (
    GuildMemberRead,
    HqCommanderRead,
    HqFormationLeadershipRead,
    HqLeadershipRead,
    HqPersonRead,
    InactiveMemberRead,
    MemberProfileUpdate,
    PointsAdjustmentBody,
    RegimentCommanderCreate,
    RegimentCommanderRead,
    SquadBadge,
    TenureOverrideUpdate,
)
from app.schemas.report import ReportRead
from app.schemas.report_category import ReportCategoryCreate, ReportCategoryRead, ReportCategoryUpdate
from app.schemas.squad import (
    SquadCreate,
    SquadMemberCreate,
    SquadMemberTierUpdate,
    SquadRead,
    SquadTierLabelsUpdate,
)

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


def _check_rank_matches_regiment(rank, regiment) -> None:
    # jedi order <-> jedi ranks only, no mixing
    if regiment.is_jedi_order and not rank.tier.is_jedi:
        raise AppError("Этому формированию можно назначить только джедайское звание")
    if not regiment.is_jedi_order and rank.tier.is_jedi:
        raise AppError("Обычному формированию нельзя назначить джедайское звание")


async def _check_jedi_title_ceiling(db: AsyncSession, *, rang_rank_id: int | None, jedi_title_id: int) -> None:
    """Ранг ограничивает потолок звания (не коррелирует с ним напрямую) —
    Падаван до SCO, Рыцарь до GEN, Мастер до SGEN, Гранд-Мастер до HGEN. См.
    Rank.max_jedi_title_rank_id, выставлено миграцией 0078 на джедайских рангах."""
    rang_rank = await rank_crud.get_by_id(db, rang_rank_id) if rang_rank_id is not None else None
    if rang_rank is None or rang_rank.max_jedi_title_rank_id is None:
        raise AppError("Звание можно назначить только тому, у кого уже есть джедайский ранг")
    ordered_ranks = await rank_crud.get_all_ranks_ordered(db)
    order_index = {r.id: i for i, r in enumerate(ordered_ranks)}
    if jedi_title_id not in order_index or rang_rank.max_jedi_title_rank_id not in order_index:
        raise AppError("Звание не найдено")
    if order_index[jedi_title_id] > order_index[rang_rank.max_jedi_title_rank_id]:
        raise AppError("Звание выше потолка, допустимого для текущего ранга")


async def _check_padawan_trials_complete(db: AsyncSession, target_user) -> None:
    """Смена ранга на Рыцаря требует все 5 испытаний сданными + разрыв
    GRADUATION_GAP_DAYS после пятого (см. app/crud/jedi_trial.py)."""
    passed = await jedi_trial_crud.list_for_user(db, user_id=target_user.id)
    if jedi_trial_crud.next_trial_number(passed) is not None:
        raise AppError("Нельзя аттестовать на Рыцаря — сданы не все 5 испытаний")
    available_at = jedi_trial_crud.graduation_available_at(passed)
    now = datetime.now(timezone.utc)
    if available_at is not None and now < available_at:
        raise AppError(
            f"Аттестация на Рыцаря доступна не раньше {available_at.strftime('%d.%m.%Y %H:%M')} МСК "
            f"(разрыв после 5-го испытания)"
        )


@router.get("", response_model=list[RegimentRead])
async def list_regiments(
    include_archived: bool = False,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[RegimentRead]:
    """Список формирований — виден всем авторизованным пользователям (нужен для формы
    рапорта). Замороженные (is_archived) по умолчанию скрыты — не удалены, просто не
    участвуют в активном использовании (см. решение пользователя). include_archived
    показывает и их — только для администратора (страница управления формированиями)."""
    regiments = await regiment_crud.get_all(db, include_archived=include_archived and access.is_admin)
    return [RegimentRead.model_validate(r) for r in regiments]


@router.get("/hq-leadership", response_model=HqLeadershipRead)
async def get_hq_leadership(
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> HqLeadershipRead:
    """Статичный список командования всех формирований для страницы Штаба — виден
    любому авторизованному бойцу (см. решение пользователя), высшее командование
    отдельным блоком сверху. Командиров/замов формирования регистрируют в
    Формирования -> Настроить (см. RegimentCommander) — если список пуст/почти
    пуст, значит их пока не назначили."""
    regiments = await regiment_crud.get_all(db)
    all_commanders = await regiment_commander_crud.get_all(db)
    commanders_by_regiment: dict[int, list] = {}
    for c in all_commanders:
        commanders_by_regiment.setdefault(c.regiment_id, []).append(c)

    app_config = await app_settings_crud.get(db)
    members = await discord_client.fetch_guild_members()
    members_by_discord_id = {m["discord_id"]: m for m in members}
    # реальный профиль (ИДН/звание/позывной) для formatFullName на фронте — тот
    # же формат, что и везде (см. решение пользователя), а не сырой Discord-ник
    users_by_discord_id = {
        u.discord_id: u
        for u in await user_crud.get_by_discord_ids(
            db, list({*members_by_discord_id.keys(), *(c.discord_id for c in all_commanders)})
        )
    }

    def _build_person(discord_id: str, fallback_username: str) -> HqPersonRead:
        user = users_by_discord_id.get(discord_id)
        member = members_by_discord_id.get(discord_id)
        if user is not None:
            return HqPersonRead(
                discord_id=discord_id,
                username=user.username,
                nickname_override=user.nickname_override,
                service_id=user.service_id,
                callsign=user.callsign,
                rank=RankRead.model_validate(user.rank) if user.rank else None,
                avatar_url=member["avatar_url"] if member else user.avatar_url,
            )
        return HqPersonRead(
            discord_id=discord_id,
            username=member["username"] if member else fallback_username,
            avatar_url=member["avatar_url"] if member else None,
        )

    high_command: list[HqPersonRead] = []
    if app_config.high_command_role_id:
        high_command = [
            _build_person(m["discord_id"], m["username"])
            for m in members
            if app_config.high_command_role_id in m["roles"]
        ]

    formations = [
        HqFormationLeadershipRead(
            regiment_id=r.id,
            regiment_name=r.name,
            regiment_color=r.color,
            commanders=[
                HqCommanderRead(role_type=c.role_type, person=_build_person(c.discord_id, c.username))
                for c in commanders_by_regiment.get(r.id, [])
            ],
        )
        for r in regiments
    ]

    return HqLeadershipRead(high_command=high_command, formations=formations)


@router.get("/discord-roles", response_model=list[DiscordRoleOption])
async def get_discord_roles(access: AccessContext = Depends(get_access_context)) -> list[DiscordRoleOption]:
    """Список ролей единственного Discord-сервера — для выбора роли формирования в веб-панели."""
    if not access.is_admin:
        raise ForbiddenError("Только администратор может настраивать формирования")

    roles = await discord_client.fetch_guild_roles()
    return [DiscordRoleOption(**role) for role in roles]


@router.get("/members/inactive", response_model=list[InactiveMemberRead])
async def list_inactive_members(
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[InactiveMemberRead]:
    """Разжалованные поперёк ВСЕХ формирований разом (Админ-панель) — иначе их
    искать пришлось бы по формированиям вручную, не помня, где боец служил (см.
    решение пользователя). ИДН/звание/позывной не показываем — обнулены при
    разжаловании; формирование определяем по живой Discord-роли (роль не
    снимается автоматически при разжаловании, см. app/crud/user.py::update_profile)."""
    if not (access.is_admin or access.is_high_command):
        raise ForbiddenError("Список разжалованных доступен только администратору/высшему командованию")

    inactive_users = await user_crud.list_inactive(db)
    if not inactive_users:
        return []

    regiments = await regiment_crud.get_all(db, include_archived=True)
    members = await discord_client.fetch_guild_members()
    members_by_discord_id = {m["discord_id"]: m for m in members}

    entries: list[InactiveMemberRead] = []
    for user in inactive_users:
        member = members_by_discord_id.get(user.discord_id)
        role_ids = set(member["roles"]) if member else set()
        matched_regiments = [r for r in regiments if r.discord_role_id in role_ids]
        entries.append(
            InactiveMemberRead(
                discord_id=user.discord_id,
                username=member["username"] if member else user.username,
                avatar_url=member["avatar_url"] if member else user.avatar_url,
                regiment_names=[r.name for r in matched_regiments],
                regiment_ids=[r.id for r in matched_regiments],
                last_login_at=user.last_login_at,
            )
        )
    entries.sort(key=lambda e: e.username)
    return entries


@router.post("", response_model=RegimentRead, status_code=201)
async def create_regiment(
    payload: RegimentCreate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> RegimentRead:
    """Создание формирования: название + роль на едином Discord-сервере — только администратор."""
    if not access.is_admin:
        raise ForbiddenError("Только администратор может создавать формирования")

    if payload.starting_rank_id is not None:
        starting_rank = await rank_crud.get_by_id(db, payload.starting_rank_id)
        if starting_rank is None:
            raise NotFoundError("Стартовое звание не найдено")
        if payload.is_jedi_order and not starting_rank.tier.is_jedi:
            raise AppError("Этому формированию можно назначить только джедайское стартовое звание")
        if not payload.is_jedi_order and starting_rank.tier.is_jedi:
            raise AppError("Обычному формированию нельзя назначить джедайское стартовое звание")

    regiment = await regiment_crud.create(
        db,
        name=payload.name,
        discord_role_id=payload.discord_role_id,
        color=payload.color,
        discord_channel_url=payload.discord_channel_url,
        is_jedi_order=payload.is_jedi_order,
        starting_rank_id=payload.starting_rank_id,
    )
    logger.info("Администратор %s создал формирование %s", access.user.username, regiment.name)
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="regiment_create",
        details=f"Создал формирование «{regiment.name}»",
    )
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

    if changes.get("starting_rank_id") is not None:
        starting_rank = await rank_crud.get_by_id(db, changes["starting_rank_id"])
        if starting_rank is None:
            raise NotFoundError("Стартовое звание не найдено")
        is_jedi_order = changes.get("is_jedi_order", regiment.is_jedi_order)
        if is_jedi_order and not starting_rank.tier.is_jedi:
            raise AppError("Этому формированию можно назначить только джедайское стартовое звание")
        if not is_jedi_order and starting_rank.tier.is_jedi:
            raise AppError("Обычному формированию нельзя назначить джедайское стартовое звание")

    updated = await regiment_crud.update(db, regiment, **changes)
    logger.info("Администратор %s обновил формирование %s", access.user.username, updated.name)
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="regiment_update",
        details=f"Изменил формирование «{updated.name}»: {changes}",
    )
    return RegimentRead.model_validate(updated)


# --- Категории рапортов -----------------------------------------------------------


@router.get("/{regiment_id}/categories", response_model=list[ReportCategoryRead])
async def list_categories(
    regiment_id: int,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[ReportCategoryRead]:
    """Категории рапортов формирования — доступно всем, у кого есть доступ к формированию,
    а также инструктору (нужны категории обучения любого формирования)."""
    if not access.can_grant_specializations:
        _require_regiment_access(access, regiment_id)
    await _get_regiment_or_404(db, regiment_id)
    categories = await report_category_crud.get_by_regiment(db, regiment_id)
    return [ReportCategoryRead.model_validate(c) for c in categories]


async def _can_manage_discipline_category(
    db: AsyncSession, access: AccessContext, required_specialization_id: int | None
) -> bool:
    """DEP+/куратор дисциплины может заводить/менять СВОИ категории (например
    "Пост", "Оказание помощи") в любом формировании — привязка к дисциплине
    идёт через required_specialization_id, не через regiment_id. Категория без
    привязки (required_specialization_id=None) — не их дело, только
    высшее командование/админ (can_manage_categories)."""
    if required_specialization_id is None:
        return False
    specialization = await specialization_crud.get_by_id(db, required_specialization_id)
    if specialization is None or specialization.category not in DISCIPLINE_CATEGORIES:
        return False
    return access.is_discipline_deputy(specialization.category)


async def _validate_required_squad(db: AsyncSession, regiment_id: int, required_squad_id: int | None) -> None:
    if required_squad_id is None:
        return
    squad = await squad_crud.get_by_id(db, required_squad_id)
    if squad is None or squad.regiment_id != regiment_id:
        raise AppError("Отряд не найден в этом формировании")


@router.post("/{regiment_id}/categories", response_model=ReportCategoryRead, status_code=201)
async def create_category(
    regiment_id: int,
    payload: ReportCategoryCreate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> ReportCategoryRead:
    """Добавить категорию рапорта — высшее командование/администратор, либо
    DEP+/куратор дисциплины для СВОЕЙ категории (required_specialization_id)."""
    if not access.can_manage_categories(regiment_id) and not await _can_manage_discipline_category(
        db, access, payload.required_specialization_id
    ):
        raise ForbiddenError(
            "Добавлять категории может высшее командование/администратор, либо DEP+/куратор своей дисциплины"
        )
    await _get_regiment_or_404(db, regiment_id)
    await _validate_required_squad(db, regiment_id, payload.required_squad_id)

    category = await report_category_crud.create(
        db,
        regiment_id=regiment_id,
        name=payload.name,
        fields=[f.model_dump() for f in payload.fields],
        points=payload.points,
        participant_points=payload.participant_points,
        # is_detention всегда False здесь — категория задержания системная,
        # заводится автоматически при создании формирования (см. regiment_crud.create)
        is_detention=False,
        min_rank_id=payload.min_rank_id,
        commander_only=payload.commander_only,
        required_specialization_id=payload.required_specialization_id,
        open_to_regiment_leadership=payload.open_to_regiment_leadership,
        required_squad_id=payload.required_squad_id,
        is_joint=payload.is_joint,
        max_per_day=payload.max_per_day,
    )
    logger.info("%s добавил категорию '%s' формированию %s", access.user.username, category.name, regiment_id)
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="category_create",
        details=f"Добавил категорию «{category.name}» формированию #{regiment_id}",
    )
    return ReportCategoryRead.model_validate(category)


@router.patch("/{regiment_id}/categories/{category_id}", response_model=ReportCategoryRead)
async def update_category(
    regiment_id: int,
    category_id: int,
    payload: ReportCategoryUpdate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> ReportCategoryRead:
    """Переименовать категорию и/или изменить список полей рапорта — высшее
    командование/администратор, либо DEP+/куратор дисциплины для своей категории."""
    category = await report_category_crud.get_by_id(db, category_id)
    if category is None or category.regiment_id != regiment_id:
        raise NotFoundError("Категория не найдена")

    if not access.can_manage_categories(regiment_id) and not await _can_manage_discipline_category(
        db, access, category.required_specialization_id
    ):
        raise ForbiddenError(
            "Изменять категории может высшее командование/администратор, либо DEP+/куратор своей дисциплины"
        )

    changes = payload.model_dump(exclude_unset=True)
    if "required_specialization_id" in changes and not access.can_manage_categories(regiment_id):
        # DEP/CU не может перевесить категорию на чужую дисциплину или снять привязку
        if not await _can_manage_discipline_category(db, access, changes["required_specialization_id"]):
            raise ForbiddenError("Нельзя перенести категорию в дисциплину, которой вы не курируете")
    if "required_squad_id" in changes:
        await _validate_required_squad(db, regiment_id, changes["required_squad_id"])
    if changes.get("is_joint") and (
        category.is_detention
        or category.is_promotion
        or category.is_demotion
        or category.is_training
        or category.is_recruit_promotion
        or category.is_jedi_trial_report
    ):
        raise AppError("Совместной категорией не может быть системная (задержание/повышение/понижение/обучение/КМБ/наставничество)")
    # is_detention системный, вручную не редактируется (категория задержания заводится
    # автоматически при создании формирования)
    changes.pop("is_detention", None)
    updated = await report_category_crud.update(db, category, **changes)
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="category_update",
        details=f"Изменил категорию «{updated.name}»: {changes}",
    )
    return ReportCategoryRead.model_validate(updated)


@router.delete("/{regiment_id}/categories/{category_id}", status_code=204)
async def delete_category(
    regiment_id: int,
    category_id: int,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> None:
    """Удалить категорию рапорта — высшее командование/администратор, либо
    DEP+/куратор дисциплины для своей категории."""
    category = await report_category_crud.get_by_id(db, category_id)
    if category is None or category.regiment_id != regiment_id:
        raise NotFoundError("Категория не найдена")
    if (
        category.is_detention
        or category.is_promotion
        or category.is_demotion
        or category.is_training
        or category.is_recruit_promotion
        or category.is_jedi_trial_report
    ):
        raise ForbiddenError("Это системная категория, её нельзя удалить")
    if not access.can_manage_categories(regiment_id) and not await _can_manage_discipline_category(
        db, access, category.required_specialization_id
    ):
        raise ForbiddenError(
            "Удалять категории может высшее командование/администратор, либо DEP+/куратор своей дисциплины"
        )

    await report_category_crud.delete(db, category)
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="category_delete",
        details=f"Удалил категорию «{category.name}» формирования #{regiment_id}",
    )


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


@router.get("/{regiment_id}/mentor-candidates", response_model=list[GuildMemberRead])
async def get_mentor_candidates(
    regiment_id: int,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[GuildMemberRead]:
    # members of mentor_source_regiment_ids + all jedi characters
    if not access.is_admin:
        raise ForbiddenError("Только администратор может назначать наставников")

    app_config = await app_settings_crud.get(db)
    source_regiments = [
        r for r in await regiment_crud.get_all(db) if r.id in app_config.mentor_source_regiment_ids
    ]
    source_role_ids = {r.discord_role_id for r in source_regiments}

    members = await discord_client.fetch_guild_members()
    candidates_by_discord_id = {
        m["discord_id"]: m for m in members if source_role_ids & set(m["roles"])
    }

    jedi_characters = await character_crud.list_jedi(db)
    members_by_discord_id = {m["discord_id"]: m for m in members}
    for character in jedi_characters:
        discord_id = character.user.discord_id
        if discord_id in candidates_by_discord_id:
            continue
        fallback_member = members_by_discord_id.get(discord_id) or {
            "discord_id": discord_id,
            "username": character.user.username,
            "avatar_url": character.user.avatar_url,
            "roles": [],
        }
        candidates_by_discord_id[discord_id] = fallback_member

    return [
        GuildMemberRead(
            discord_id=m["discord_id"],
            username=m["username"],
            discord_username=m["username"],
            avatar_url=m["avatar_url"],
            is_commander_role=app_config.commander_role_id in m["roles"],
            is_deputy_role=app_config.deputy_role_id in m["roles"],
        )
        for m in candidates_by_discord_id.values()
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
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="commander_assign",
        details=f"Назначил {payload.username} ({payload.role_type}) на формирование #{regiment_id}",
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
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="commander_remove",
        details=f"Снял командира {discord_id} с формирования #{regiment_id}",
    )


# --- Отряды (подгруппы внутри формирования, только ярлык в составе, см. решение
# пользователя — никаких прав сверх обычного бойца статус в отряде не даёт) ---


def _can_manage_squads(access: AccessContext, regiment_id: int) -> bool:
    return access.is_admin or regiment_id in access.category_manager_regiment_ids


@router.get("/{regiment_id}/squads", response_model=list[SquadRead])
async def list_squads(
    regiment_id: int,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[SquadRead]:
    _require_regiment_access(access, regiment_id)
    await _get_regiment_or_404(db, regiment_id)
    squads = await squad_crud.list_by_regiment(db, regiment_id=regiment_id)
    result = []
    for s in squads:
        members = await squad_crud.list_members(db, squad_id=s.id)
        result.append(SquadRead(id=s.id, regiment_id=s.regiment_id, name=s.name, tier_labels=s.tier_labels, members=members))
    return result


@router.post("/{regiment_id}/squads", response_model=SquadRead, status_code=201)
async def create_squad(
    regiment_id: int,
    payload: SquadCreate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> SquadRead:
    if not _can_manage_squads(access, regiment_id):
        raise ForbiddenError("Заводить отряды может командир формирования или администратор")
    await _get_regiment_or_404(db, regiment_id)
    squad = await squad_crud.create(db, regiment_id=regiment_id, name=payload.name.strip())
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="squad_create",
        details=f"Завёл отряд «{squad.name}» в формировании #{regiment_id}",
    )
    return SquadRead(id=squad.id, regiment_id=squad.regiment_id, name=squad.name, tier_labels=squad.tier_labels, members=[])


@router.patch("/{regiment_id}/squads/{squad_id}", response_model=SquadRead)
async def update_squad_tier_labels(
    regiment_id: int,
    squad_id: int,
    payload: SquadTierLabelsUpdate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> SquadRead:
    if not _can_manage_squads(access, regiment_id):
        raise ForbiddenError("Настраивать отряды может командир формирования или администратор")
    squad = await squad_crud.get_by_id(db, squad_id)
    if squad is None or squad.regiment_id != regiment_id:
        raise NotFoundError("Отряд не найден")
    squad = await squad_crud.update_tier_labels(db, squad, tier_labels=[t.strip() or DEFAULT_SQUAD_TIER_LABELS[i] for i, t in enumerate(payload.tier_labels)])
    members = await squad_crud.list_members(db, squad_id=squad.id)
    return SquadRead(id=squad.id, regiment_id=squad.regiment_id, name=squad.name, tier_labels=squad.tier_labels, members=members)


@router.delete("/{regiment_id}/squads/{squad_id}", status_code=204)
async def delete_squad(
    regiment_id: int,
    squad_id: int,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> None:
    if not _can_manage_squads(access, regiment_id):
        raise ForbiddenError("Удалять отряды может командир формирования или администратор")
    squad = await squad_crud.get_by_id(db, squad_id)
    if squad is None or squad.regiment_id != regiment_id:
        raise NotFoundError("Отряд не найден")
    await squad_crud.delete(db, squad)
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="squad_delete",
        details=f"Удалил отряд «{squad.name}» из формирования #{regiment_id}",
    )


@router.post("/{regiment_id}/squads/{squad_id}/members", status_code=201)
async def add_squad_member(
    regiment_id: int,
    squad_id: int,
    payload: SquadMemberCreate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> dict:
    if not _can_manage_squads(access, regiment_id):
        raise ForbiddenError("Управлять составом отряда может командир формирования или администратор")
    squad = await squad_crud.get_by_id(db, squad_id)
    if squad is None or squad.regiment_id != regiment_id:
        raise NotFoundError("Отряд не найден")
    await squad_crud.add_member(db, squad_id=squad_id, discord_id=payload.discord_id, username=payload.username, tier=payload.tier)
    return {"ok": True}


@router.patch("/{regiment_id}/squads/{squad_id}/members/{discord_id}", status_code=200)
async def update_squad_member_tier(
    regiment_id: int,
    squad_id: int,
    discord_id: str,
    payload: SquadMemberTierUpdate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> dict:
    if not _can_manage_squads(access, regiment_id):
        raise ForbiddenError("Управлять составом отряда может командир формирования или администратор")
    squad = await squad_crud.get_by_id(db, squad_id)
    if squad is None or squad.regiment_id != regiment_id:
        raise NotFoundError("Отряд не найден")
    membership = await squad_crud.get_membership(db, squad_id=squad_id, discord_id=discord_id)
    if membership is None:
        raise NotFoundError("Этот человек не состоит в отряде")
    await squad_crud.update_member_tier(db, membership, tier=payload.tier)
    return {"ok": True}


@router.delete("/{regiment_id}/squads/{squad_id}/members/{discord_id}", status_code=204)
async def remove_squad_member(
    regiment_id: int,
    squad_id: int,
    discord_id: str,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> None:
    if not _can_manage_squads(access, regiment_id):
        raise ForbiddenError("Управлять составом отряда может командир формирования или администратор")
    squad = await squad_crud.get_by_id(db, squad_id)
    if squad is None or squad.regiment_id != regiment_id:
        raise NotFoundError("Отряд не найден")
    membership = await squad_crud.get_membership(db, squad_id=squad_id, discord_id=discord_id)
    if membership is None:
        raise NotFoundError("Этот человек не состоит в отряде")
    await squad_crud.remove_member(db, membership)


# --- Состав формирования (ростер) ---------------------------------------------------


def _build_guild_member(
    member: dict,
    user: User | None,
    character: Character | None = None,
    squads: list[SquadBadge] | None = None,
    last_report_at: datetime | None = None,
) -> GuildMemberRead:
    # character overrides profile fields if user has one in this regiment
    days_in_rank = None
    rank_assigned_at = character.rank_assigned_at if character else (user.rank_assigned_at if user else None)
    if rank_assigned_at is not None:
        days_in_rank = (datetime.now(timezone.utc) - rank_assigned_at).days

    if character is not None:
        return GuildMemberRead(
            discord_id=member["discord_id"],
            username=member["username"],
            discord_username=member["username"],
            avatar_url=member["avatar_url"],
            service_id=character.service_id,
            callsign=character.callsign,
            steam_id=character.steam_id or (user.steam_id if user else None),
            photo_url=user.photo_url if user else None,
            rank=RankRead.model_validate(character.rank) if character.rank else None,
            days_in_rank=days_in_rank,
            is_inactive=character.is_inactive,
            rank_assigned_at=rank_assigned_at,
            squads=squads or [],
            last_report_at=last_report_at,
        )

    return GuildMemberRead(
        discord_id=member["discord_id"],
        username=(user.nickname_override if user and user.nickname_override else member["username"]),
        discord_username=member["username"],
        avatar_url=member["avatar_url"],
        service_id=user.service_id if user else None,
        callsign=user.callsign if user else None,
        steam_id=user.steam_id if user else None,
        photo_url=user.photo_url if user else None,
        rank=RankRead.model_validate(user.rank) if user and user.rank else None,
        jedi_title=RankRead.model_validate(user.jedi_title) if user and user.jedi_title else None,
        jedi_council_seat=user.jedi_council_seat if user else None,
        days_in_rank=days_in_rank,
        is_inactive=user.is_inactive if user else False,
        early_promoted_by_username=user.early_promoted_by_username if user else None,
        early_promotion_reason=user.early_promotion_reason if user else None,
        last_login_at=user.last_login_at if user else None,
        joined_at=user.created_at if user else None,
        rank_assigned_at=rank_assigned_at,
        registration_status=user.registration_status if user else None,
        squads=squads or [],
        last_report_at=last_report_at,
    )


@router.get("/{regiment_id}/members", response_model=list[GuildMemberRead])
async def get_members(
    regiment_id: int,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[GuildMemberRead]:
    """Список участников сервера, состоящих в этом формировании — виден бойцам,
    командирам и администратору этого формирования, а также инструктору (нужен
    состав любого формирования для запрета на обучение). Ник переопределяется
    веб-ником, если командир его задал (см. PATCH .../members/{discord_id}/nickname).

    Отдельное исключение для 17-го Передового Полка (см. can_decide_promotion) —
    его состав виден командиру/заму ЛЮБОГО формирования, не только 17-го,
    иначе "Рекрутскую" не открыть тому, кто вправе решать по его бойцам, но
    не состоит там сам (см. решение пользователя). Именно поэтому это узкое
    исключение прямо здесь, а не расширение _require_regiment_access целиком —
    та функция используется и там, где такой широты не просили (редактирование
    категорий/состава и т.д.)."""
    is_recruit_regiment_viewer = (
        access.recruit_regiment_id is not None
        and regiment_id == access.recruit_regiment_id
        and bool(access.commander_regiment_ids)
    )
    if not access.can_grant_specializations and not is_recruit_regiment_viewer:
        _require_regiment_access(access, regiment_id)
    regiment = await _get_regiment_or_404(db, regiment_id)

    members = await discord_client.fetch_guild_members()
    members_by_discord_id = {m["discord_id"]: m for m in members}
    roster = [m for m in members if regiment.discord_role_id in m["roles"]]
    roster_discord_ids = {m["discord_id"] for m in roster}

    # characters can be in roster without the actual discord role
    characters = await character_crud.get_by_regiment_id(db, regiment_id=regiment_id)
    characters_by_discord_id = {c.user.discord_id: c for c in characters}

    for character in characters:
        discord_id = character.user.discord_id
        if discord_id in roster_discord_ids:
            continue
        fallback_member = members_by_discord_id.get(discord_id) or {
            "discord_id": discord_id,
            "username": character.user.username,
            "avatar_url": character.user.avatar_url,
            "roles": [],
        }
        roster.append(fallback_member)
        roster_discord_ids.add(discord_id)

    users_by_discord_id = {
        u.discord_id: u
        for u in await user_crud.get_by_discord_ids(db, [m["discord_id"] for m in roster])
    }

    squad_badges_by_discord_id: dict[str, list[SquadBadge]] = {}
    for membership, squad in await squad_crud.list_memberships_for_regiment(db, regiment_id=regiment_id):
        label = squad.tier_labels[membership.tier] if membership.tier < len(squad.tier_labels) else squad.name
        squad_badges_by_discord_id.setdefault(membership.discord_id, []).append(
            SquadBadge(squad_name=squad.name, tier_label=label, tier=membership.tier)
        )

    last_report_at_by_user_id = await report_crud.last_report_at_by_user_ids(
        db, [u.id for u in users_by_discord_id.values()]
    )

    return [
        _build_guild_member(
            m,
            users_by_discord_id.get(m["discord_id"]),
            characters_by_discord_id.get(m["discord_id"]),
            squad_badges_by_discord_id.get(m["discord_id"]),
            last_report_at_by_user_id.get(users_by_discord_id[m["discord_id"]].id)
            if m["discord_id"] in users_by_discord_id
            else None,
        )
        for m in roster
    ]


@router.patch("/{regiment_id}/members/{discord_id}/profile", response_model=GuildMemberRead)
async def update_member_profile(
    regiment_id: int,
    discord_id: str,
    payload: MemberProfileUpdate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> GuildMemberRead:
    """Единая форма профиля участника формирования — ИДН, звание, позывной, отметка
    неактивности. Доступно командиру или заместителю (это работа с личным составом,
    а не управление категориями, которое заместителю недоступно).

    Веб-ник и позывной — одно и то же: отдельного поля "ник" больше нет, при смене
    позывного nickname_override (то, что показывается в рапортах/статистике)
    выставляется равным ему автоматически."""
    if not access.is_commander_of(regiment_id):
        raise ForbiddenError("Менять профиль участника может только командир формирования")
    regiment = await _get_regiment_or_404(db, regiment_id)

    members = await discord_client.fetch_guild_members()
    member = next((m for m in members if m["discord_id"] == discord_id), None)
    if member is None or regiment.discord_role_id not in member["roles"]:
        raise NotFoundError("Участник не найден в этом формировании")

    changes = payload.model_dump(exclude_unset=True)
    early_promotion_reason = changes.pop("early_promotion_reason", None)
    if "callsign" in changes:
        changes["nickname_override"] = changes["callsign"]

    existing_user = await user_crud.get_by_discord_id(db, discord_id)
    is_admin_or_hc = access.is_admin or access.is_high_command

    if "rank_id" in changes and changes["rank_id"] is not None:
        rank = await rank_crud.get_by_id(db, changes["rank_id"])
        if rank is None:
            raise NotFoundError("Звание не найдено")
        _check_rank_matches_regiment(rank, regiment)
        # Гранд-Мастер — исключение, назначает только админ/высшее командование
        # (см. миграцию 0078, Rank.jedi_manual_only и партиционный уникальный
        # индекс uq_users_single_grand_master — только один Гранд-Мастер сразу)
        if rank.jedi_manual_only and not is_admin_or_hc:
            raise ForbiddenError("Этот ранг может назначить только администратор или высшее командование")
        # Аттестация на Рыцаря — все 5 испытаний должны быть сданы (см.
        # app/crud/jedi_trial.py), проверяем только когда рангом реально меняем
        if rank.code == "KNT" and existing_user is not None and existing_user.rank_id != rank.id:
            await _check_padawan_trials_complete(db, existing_user)

    if "jedi_title_id" in changes and changes["jedi_title_id"] is not None:
        if not is_admin_or_hc:
            raise ForbiddenError("Звание джедая может менять только администратор или высшее командование")
        title_rank = await rank_crud.get_by_id(db, changes["jedi_title_id"])
        if title_rank is None:
            raise NotFoundError("Звание не найдено")
        if not (title_rank.tier.is_jedi and not title_rank.tier.is_jedi_rank_track):
            raise AppError("Это поле принимает только джедайское звание (CO/SCO/GEN/SGEN/HGEN)")
        effective_rang_rank_id = changes.get("rank_id", existing_user.rank_id if existing_user else None)
        await _check_jedi_title_ceiling(
            db, rang_rank_id=effective_rang_rank_id, jedi_title_id=changes["jedi_title_id"]
        )
    elif "jedi_title_id" in changes and not is_admin_or_hc:
        raise ForbiddenError("Звание джедая может менять только администратор или высшее командование")

    if "jedi_council_seat" in changes:
        if not is_admin_or_hc:
            raise ForbiddenError("Совет Ордена назначает только администратор или высшее командование")
        seat = changes["jedi_council_seat"]
        if seat is not None:
            if not regiment.is_jedi_order:
                raise AppError("Совет Ордена есть только у джедайских формирований")
            if seat not in JEDI_COUNCIL_SEATS:
                raise AppError("Неизвестная должность в Совете Ордена")

    old_rank_id = existing_user.rank_id if existing_user else None
    new_rank_id = changes.get("rank_id")
    rank_changed = "rank_id" in changes and new_rank_id != old_rank_id
    jedi_title_changed = "jedi_title_id" in changes and changes["jedi_title_id"] != (
        existing_user.jedi_title_id if existing_user else None
    )
    if rank_changed or jedi_title_changed:
        # Смена звания/ранга вручную (не через обычную заявку) — фиксируем, кто и
        # почему, чтобы это было видно в личном деле бойца (см. GuildMemberRead)
        changes["early_promoted_by_username"] = access.user.username
        changes["early_promotion_reason"] = early_promotion_reason

    is_demotion = False
    if rank_changed and old_rank_id is not None and new_rank_id is not None:
        ordered_ranks = await rank_crud.get_all_ranks_ordered(db)
        order_index = {r.id: i for i, r in enumerate(ordered_ranks)}
        if old_rank_id in order_index and new_rank_id in order_index:
            is_demotion = order_index[new_rank_id] < order_index[old_rank_id]

    try:
        user = await user_crud.update_profile(
            db, discord_id=discord_id, fallback_username=member["username"], changes=changes
        )
    except IntegrityError:
        await db.rollback()
        if "jedi_council_seat" in changes and changes["jedi_council_seat"] is not None:
            raise AppError("Эта должность в Совете Ордена уже занята другим бойцом — сначала снимите её")
        raise AppError("Гранд-Мастер уже назначен другому бойцу — сначала снимите ранг с текущего")
    logger.info("%s обновил профиль участника %s: %s", access.user.username, discord_id, changes)

    if rank_changed:
        # Ранг сменился в обход обычной заявки на повышение — если у бойца была
        # зависшая pending-заявка от СТАРОГО ранга, гасим её, иначе на странице
        # Повышения виснет карточка с несуществующим уже переходом (баг-репорт)
        await promotion_crud.cancel_pending_for_user(
            db, user_id=user.id, reason="Ранг изменён вручную, минуя заявку на повышение"
        )

    if is_demotion:
        # mirror demotion as a report, same as promotion requests
        demotion_category = await report_category_crud.get_by_name(
            db, regiment_id=regiment_id, name=regiment_crud.DEMOTION_CATEGORY_NAME
        )
        if demotion_category is not None:
            old_rank = await rank_crud.get_by_id(db, old_rank_id)
            new_rank = await rank_crud.get_by_id(db, new_rank_id)
            content = f"Понижение: {old_rank.code if old_rank else '—'} → {new_rank.code if new_rank else '—'}"
            if early_promotion_reason:
                content += f" — {early_promotion_reason}"
            mirror_report = await report_crud.create_report(
                db,
                user_id=user.id,
                regiment_id=regiment_id,
                category_id=demotion_category.id,
                content=content,
                status=ReportStatus.SUBMITTED,
                author_rank_id=new_rank_id,
            )
            await report_crud.update_status(
                db,
                mirror_report,
                status=ReportStatus.APPROVED,
                updated_by=access.user.id,
                updated_by_rank_id=access.user.rank_id,
            )
    # Пишем в историю всегда (не только для админа/высшего командования) — иначе
    # правки обычного командира/заместителя нигде не отследить в личном деле
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="member_profile_edit",
        details=f"Профиль участника {discord_id} в формировании {regiment_id}: {changes}",
        target_user_id=user.id,
    )
    return _build_guild_member(member, user)


@router.post("/{regiment_id}/members/{discord_id}/reset-registration", response_model=GuildMemberRead)
async def reset_member_registration(
    regiment_id: int,
    discord_id: str,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> GuildMemberRead:
    """Лёгкий сброс регистрации — в отличие от «Разжаловать» (is_inactive=True)
    НЕ трогает звание/позывной/ИДН-запись в истории и не прячет бойца из
    состава, только заставляет заново пройти терминал зачисления (например,
    перепривязать Steam-аккаунт). Строго Высшая администрация (is_admin) — это
    административная операция поверх обычного редактирования профиля, доступного
    и простому командиру/заму (см. решение пользователя)."""
    if not access.is_admin:
        raise ForbiddenError("Сбросить регистрацию может только Высшая администрация")
    regiment = await _get_regiment_or_404(db, regiment_id)

    members = await discord_client.fetch_guild_members()
    member = next((m for m in members if m["discord_id"] == discord_id), None)
    if member is None or regiment.discord_role_id not in member["roles"]:
        raise NotFoundError("Участник не найден в этом формировании")

    target = await user_crud.get_by_discord_id(db, discord_id)
    if target is None:
        raise NotFoundError("У этого участника ещё нет записи в системе — сбрасывать нечего")

    user = await user_crud.reset_registration(db, target)
    logger.info("%s сбросил регистрацию участника %s", access.user.username, discord_id)
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="member_registration_reset",
        details=f"Сброшена регистрация участника {discord_id} в формировании {regiment_id}",
        target_user_id=user.id,
    )
    return _build_guild_member(member, user)


@router.get("/{regiment_id}/members/{discord_id}/history", response_model=list[AuditLogRead])
async def get_member_history(
    regiment_id: int,
    discord_id: str,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[AuditLogRead]:
    """История ручных правок профиля бойца (ИДН/звание/позывной/Steam ID и т.п.) —
    доступна командиру/заместителю формирования, высшему командованию и
    администратору (та же видимость, что и у самой формы редактирования профиля)."""
    if not access.is_commander_of(regiment_id):
        raise ForbiddenError("История профиля доступна только командиру/заместителю формирования")
    target = await user_crud.get_by_discord_id(db, discord_id)
    if target is None:
        raise NotFoundError("Участник не найден")
    entries = await audit_log_crud.list_for_target(db, target_user_id=target.id)
    return [AuditLogRead.model_validate(e) for e in entries]


@router.post("/{regiment_id}/members/{discord_id}/photo", response_model=GuildMemberRead)
async def upload_member_photo(
    regiment_id: int,
    discord_id: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> GuildMemberRead:
    # overrides discord avatar
    if not access.is_commander_of(regiment_id):
        raise ForbiddenError("Загружать фото может только командир формирования")
    regiment = await _get_regiment_or_404(db, regiment_id)

    members = await discord_client.fetch_guild_members()
    member = next((m for m in members if m["discord_id"] == discord_id), None)
    if member is None or regiment.discord_role_id not in member["roles"]:
        raise NotFoundError("Участник не найден в этом формировании")

    content, ext = await read_image_upload(file, allowed_types=_ALLOWED_PHOTO_TYPES, max_size=_MAX_PHOTO_SIZE)

    user = await user_crud.update_profile(
        db, discord_id=discord_id, fallback_username=member["username"], changes={}
    )
    member_dir = _PHOTO_UPLOAD_ROOT / str(user.id)
    member_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4()}{ext}"
    (member_dir / filename).write_bytes(content)

    user = await user_crud.update_profile(
        db, discord_id=discord_id, fallback_username=member["username"], changes={"photo_url": f"/uploads/members/{user.id}/{filename}"}
    )
    logger.info("%s загрузил фото для участника %s", access.user.username, discord_id)
    return _build_guild_member(member, user)


@router.delete("/{regiment_id}/members/{discord_id}/photo", response_model=GuildMemberRead)
async def delete_member_photo(
    regiment_id: int,
    discord_id: str,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> GuildMemberRead:
    if not access.is_commander_of(regiment_id):
        raise ForbiddenError("Удалять фото может только командир формирования")
    regiment = await _get_regiment_or_404(db, regiment_id)

    members = await discord_client.fetch_guild_members()
    member = next((m for m in members if m["discord_id"] == discord_id), None)
    if member is None or regiment.discord_role_id not in member["roles"]:
        raise NotFoundError("Участник не найден в этом формировании")

    user = await user_crud.update_profile(
        db, discord_id=discord_id, fallback_username=member["username"], changes={"photo_url": None}
    )
    logger.info("%s удалил фото участника %s", access.user.username, discord_id)
    return _build_guild_member(member, user)


@router.patch("/{regiment_id}/members/{discord_id}/tenure", response_model=GuildMemberRead)
async def update_member_tenure(
    regiment_id: int,
    discord_id: str,
    payload: TenureOverrideUpdate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> GuildMemberRead:
    """Админ-панель: вручную скорректировать, сколько дней участник "провёл" в
    текущем звании — только высшее командование/администратор (не обычный
    командир/заместитель, это ручной оверрайд критерия повышения)."""
    if not (access.is_admin or access.is_high_command):
        raise ForbiddenError("Менять выслугу вручную может только высшее командование или администратор")
    regiment = await _get_regiment_or_404(db, regiment_id)

    members = await discord_client.fetch_guild_members()
    member = next((m for m in members if m["discord_id"] == discord_id), None)
    if member is None or regiment.discord_role_id not in member["roles"]:
        raise NotFoundError("Участник не найден в этом формировании")

    user = await user_crud.get_by_discord_id(db, discord_id)
    if user is None or user.rank_id is None:
        raise NotFoundError("У участника не задано звание")

    user = await user_crud.set_rank_assigned_at(db, user, days_in_rank=payload.days_in_rank)
    logger.info(
        "%s вручную выставил выслугу участнику %s: %s дней", access.user.username, discord_id, payload.days_in_rank
    )
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="tenure_override",
        details=f"Выставил выслугу {payload.days_in_rank} дн. участнику {discord_id} в формировании {regiment_id}",
    )
    return _build_guild_member(member, user)


@router.post("/{regiment_id}/members/{discord_id}/points-adjustment", response_model=PointsAdjustmentRead)
async def create_points_adjustment(
    regiment_id: int,
    discord_id: str,
    payload: PointsAdjustmentBody,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> PointsAdjustmentRead:
    """Админ-панель: ручное начисление баллов бойцу в обход рапортов — только
    высшее командование/администратор."""
    if not (access.is_admin or access.is_high_command):
        raise ForbiddenError("Выдавать баллы вручную может только высшее командование или администратор")
    await _get_regiment_or_404(db, regiment_id)

    user = await user_crud.get_by_discord_id(db, discord_id)
    if user is None:
        raise NotFoundError("Участник не найден")

    adjustment = await points_adjustment_crud.create(
        db,
        user_id=user.id,
        regiment_id=regiment_id,
        points=payload.points,
        reason=payload.reason,
        created_by=access.user.id,
    )
    await promotion_crud.check_and_create_promotion_request(db, user, regiment_id=regiment_id)
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="points_adjustment",
        details=f"Начислил {payload.points} баллов участнику {discord_id} в формировании {regiment_id}: {payload.reason}",
    )
    return adjustment


@router.get("/{regiment_id}/members/{discord_id}/reports", response_model=list[ReportRead])
async def get_member_reports(
    regiment_id: int,
    discord_id: str,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[ReportRead]:
    """Все рапорты конкретного участника в этом формировании — свои (в качестве
    автора) плюс те, где он указан участником в ростер-поле категории (например,
    патруль/тренировка со списком состава) — виден любому, у кого есть доступ к
    этому формированию (боец, командир, администратор)."""
    _require_regiment_access(access, regiment_id)
    await _get_regiment_or_404(db, regiment_id)

    user = await user_crud.get_by_discord_id(db, discord_id)
    if user is None:
        return []

    own_reports = await report_crud.list_reports(
        db, regiment_ids=[regiment_id], user_id=user.id, include_deleted=True
    )
    participant_reports = await report_participant_crud.list_reports_since(
        db, user_id=user.id, regiment_id=regiment_id
    )
    reports_by_id = {r.id: r for r in own_reports}
    for r in participant_reports:
        reports_by_id.setdefault(r.id, r)
    reports = sorted(reports_by_id.values(), key=lambda r: r.created_at, reverse=True)
    return [ReportRead.model_validate(r) for r in reports]


async def _build_jedi_trial_progress(db: AsyncSession, target_user) -> JediTrialProgressRead:
    passed = await jedi_trial_crud.list_for_user(db, user_id=target_user.id)
    padawan_since = target_user.rank_assigned_at if target_user.rank and target_user.rank.code == "PDW" else None
    return JediTrialProgressRead(
        trials=[JediTrialRead.model_validate(t) for t in passed],
        next_trial_number=jedi_trial_crud.next_trial_number(passed),
        next_trial_available_at=jedi_trial_crud.earliest_available_at(passed, padawan_since=padawan_since),
        graduation_available_at=jedi_trial_crud.graduation_available_at(passed),
    )


@router.get("/{regiment_id}/members/{discord_id}/jedi-trials", response_model=JediTrialProgressRead)
async def get_member_jedi_trials(
    regiment_id: int,
    discord_id: str,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> JediTrialProgressRead:
    """Прогресс по пяти испытаниям Падавана — см. app/crud/jedi_trial.py."""
    if not access.is_commander_of(regiment_id):
        raise ForbiddenError("Испытания видит только командир/заместитель формирования")
    regiment = await _get_regiment_or_404(db, regiment_id)
    if not regiment.is_jedi_order:
        raise AppError("Испытания есть только у джедайских формирований")
    target_user = await user_crud.get_by_discord_id_with_rank(db, discord_id)
    if target_user is None:
        raise NotFoundError("Участник не найден")
    return await _build_jedi_trial_progress(db, target_user)


# Испытания отмечаются одобрением рапорта категории "Наставничество"
# (is_jedi_trial_report, см. app/api/reports.py::_apply_approval_side_effects),
# не отдельной ручкой — раньше здесь был POST .../jedi-trials/pass, убран по
# решению пользователя в пользу рапортов (баллы наставнику + видно в истории).
