"""Каталог специализаций ВАР (Медик, Инженер, Штурмовик и т.д.), их выдача бойцам
инструкторами (отдельная Discord-роль, см. Settings) и временные запреты на
обучение — с проверкой лимитов по составу (см. RankTier.*_limit)."""
import logging
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AccessContext, get_access_context
from app.crud import audit_log as audit_log_crud
from app.crud import notification as notification_crud
from app.crud import rank as rank_crud
from app.crud import regiment as regiment_crud
from app.crud import specialization as specialization_crud
from app.crud import user as user_crud
from app.database import get_db
from app.exceptions import AppError, ForbiddenError, NotFoundError
from app.models.specialization import DISCIPLINE_CATEGORIES, INSTRUCTOR_TIER_RANK, UNLIMITED_TRAINING_CODE, Specialization
from app.models.user import User
from app.schemas.specialization import (
    DisciplineRosterEntry,
    GrantSpecializationRequest,
    InstructorActivityRead,
    InstructorRoleCreate,
    InstructorRoleRead,
    SpecializationBanCreate,
    SpecializationBanRead,
    SpecializationBanWithUserRead,
    SpecializationCreate,
    SpecializationRead,
    SpecializationUpdate,
    UserSpecializationRead,
)
from app.schemas.user import UserBrief

logger = logging.getLogger(__name__)

router = APIRouter(tags=["specializations"])

_CATEGORY_LABELS = {
    "class": "общих классов",
    "gear": "общего снаряжения",
    "specialization": "общих специализаций",
    "additional_specialization": "дополнительных специализаций",
    "elite_specialization": "элитных специализаций",
}


async def _check_can_grant(db: AsyncSession, target: User, specialization: Specialization) -> None:
    """Бросает AppError, если выдача нарушает требование по родительской
    специализации/формированию, временный запрет на обучение, минимальное
    звание специализации или лимит по составу (см. вики: "Рядовой состав -
    1 Общий Класс..." и "Обучение доступно со звания PVT+")."""
    if specialization.parent_id is not None:
        has_parent = await specialization_crud.has_specialization(
            db, user_id=target.id, specialization_id=specialization.parent_id
        )
        if not has_parent:
            parent_label = specialization.parent.code if specialization.parent else "базовая специализация"
            raise AppError(f"Сначала нужна специализация «{parent_label}» — эта подспециализация от неё")

    if specialization.required_regiment_id is not None:
        required_role = specialization.required_regiment.discord_role_id if specialization.required_regiment else None
        if required_role is None or required_role not in target.roles:
            regiment_label = specialization.required_regiment.name if specialization.required_regiment else "формирования"
            raise AppError(f"Эта специализация доступна только бойцам формирования «{regiment_label}»")

    ban = await specialization_crud.get_active_blocking_ban(
        db, user_id=target.id, specialization_id=specialization.id
    )
    if ban is not None:
        until = ban.until_date.strftime("%d.%m.%Y") if ban.until_date else "бессрочно"
        raise AppError(f"На этого бойца действует запрет на обучение ({until})")

    if specialization.min_rank_id is not None:
        if target.rank_id is None:
            raise AppError(f"Для этой специализации требуется как минимум звание {specialization.min_rank.code}")
        ordered_ranks = await rank_crud.get_all_ranks_ordered(db)
        order_index = {r.id: i for i, r in enumerate(ordered_ranks)}
        if (
            target.rank_id in order_index
            and specialization.min_rank_id in order_index
            and order_index[target.rank_id] < order_index[specialization.min_rank_id]
        ):
            raise AppError(f"Для этой специализации требуется как минимум звание {specialization.min_rank.code}")

    if target.rank_id is None:
        return
    if await specialization_crud.has_unlimited_training(db, user_id=target.id, unlimited_code=UNLIMITED_TRAINING_CODE):
        return

    rank = await rank_crud.get_by_id(db, target.rank_id)
    if rank is None:
        return
    tier = await rank_crud.get_tier_by_id(db, rank.tier_id)
    if tier is None:
        return

    limit = getattr(tier, f"{specialization.category}_limit", None)
    if limit is None:
        return
    current_count = await specialization_crud.count_by_category(db, user_id=target.id, category=specialization.category)
    if current_count >= limit:
        label = _CATEGORY_LABELS.get(specialization.category, specialization.category)
        raise AppError(f"Лимит по составу «{tier.name}» исчерпан: не более {limit} {label}")


def _can_manage_catalog_category(access: AccessContext, category: str) -> bool:
    """Полный доступ к каталогу — только админ. DEP/CU дисциплины (медик/пилот/
    инженер) могут заводить/менять ступени ТОЛЬКО своей ветки — остальные
    категории (class/gear/обычная специализация и т.д.) их не касаются."""
    if access.is_admin:
        return True
    return category in DISCIPLINE_CATEGORIES and access.is_discipline_deputy(category)


@router.get("/specializations", response_model=list[SpecializationRead])
async def list_specializations(db: AsyncSession = Depends(get_db)) -> list[SpecializationRead]:
    """Каталог виден всем авторизованным — нужен, чтобы показать список в личном
    деле и в форме выдачи у инструктора."""
    specializations = await specialization_crud.get_all(db)
    return [SpecializationRead.model_validate(s) for s in specializations]


@router.get("/specializations/instructor-activity", response_model=list[InstructorActivityRead])
async def get_instructor_activity(
    period: Literal["all", "month", "week"] = Query(default="all"),
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[InstructorActivityRead]:
    """Сколько специализаций выдал каждый инструктор/админ — для контроля
    нагрузки, только администратор. period — за всё время/месяц/неделю."""
    if not access.is_admin:
        raise ForbiddenError("Дашборд активности инструкторов доступен только администратору")

    since = None
    if period == "month":
        since = datetime.now(timezone.utc) - timedelta(days=30)
    elif period == "week":
        since = datetime.now(timezone.utc) - timedelta(days=7)

    counts = await specialization_crud.count_grants_by_instructor(db, since=since)
    users = {u.id: u for u in await user_crud.get_by_ids(db, [uid for uid, _ in counts])}
    return [
        InstructorActivityRead(instructor=UserBrief.model_validate(users[uid]), grants_count=count)
        for uid, count in sorted(counts, key=lambda x: -x[1])
        if uid in users
    ]


@router.get("/specializations/discipline/{discipline}/roster", response_model=list[DisciplineRosterEntry])
async def get_discipline_roster(
    discipline: str,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[DisciplineRosterEntry]:
    """Кросс-формационный ростер: все бойцы с любой специализацией этой ветки, во
    всех формированиях сразу — виден любому (см. решение пользователя — раздел
    "Специализации" открыт всем, не только DEP/CU своей ветки). Отсортирован по
    инструкторской иерархии ветки: куратор -> зам -> инструктор -> просто
    держит специализацию без инструкторской роли."""
    if discipline not in DISCIPLINE_CATEGORIES:
        raise NotFoundError("Неизвестная дисциплина")

    grants = await specialization_crud.list_grants_by_category(db, discipline)
    regiments = await regiment_crud.get_all(db)
    instructor_roles = await specialization_crud.list_instructor_roles(db)
    matched_roles = [r for r in instructor_roles if r.can_teach_all or r.discipline == discipline]

    def best_tier(role_ids: set[str]) -> str | None:
        tiers = [r.tier for r in matched_roles if r.discord_role_id in role_ids]
        if not tiers:
            return None
        return min(tiers, key=lambda t: INSTRUCTOR_TIER_RANK.get(t, 99))

    entries = []
    for grant in grants:
        role_ids = set(grant.user.roles)
        regiment_names = [r.name for r in regiments if r.discord_role_id in role_ids]
        entries.append(
            DisciplineRosterEntry(
                user=UserBrief.model_validate(grant.user),
                specialization=SpecializationRead.model_validate(grant.specialization),
                granted_at=grant.granted_at,
                regiment_names=regiment_names,
                tier=best_tier(role_ids),
            )
        )
    entries.sort(key=lambda e: (INSTRUCTOR_TIER_RANK.get(e.tier, 99), e.user.username.lower()))
    return entries


@router.post("/specializations", response_model=SpecializationRead, status_code=201)
async def create_specialization(
    payload: SpecializationCreate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> SpecializationRead:
    if not _can_manage_catalog_category(access, payload.category):
        raise ForbiddenError(
            "Редактировать каталог специализаций может администратор, либо DEP+/куратор своей дисциплины"
        )
    specialization = await specialization_crud.create(
        db,
        code=payload.code.strip().upper(),
        name=payload.name.strip(),
        category=payload.category,
        min_rank_id=payload.min_rank_id,
        required_regiment_id=payload.required_regiment_id,
        parent_id=payload.parent_id,
    )
    logger.info("%s добавил специализацию %s (%s)", access.user.username, specialization.code, specialization.name)
    return SpecializationRead.model_validate(specialization)


@router.patch("/specializations/{specialization_id}", response_model=SpecializationRead)
async def update_specialization(
    specialization_id: int,
    payload: SpecializationUpdate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> SpecializationRead:
    specialization = await specialization_crud.get_by_id(db, specialization_id)
    if specialization is None:
        raise NotFoundError("Специализация не найдена")
    if not _can_manage_catalog_category(access, specialization.category):
        raise ForbiddenError(
            "Редактировать каталог специализаций может администратор, либо DEP+/куратор своей дисциплины"
        )
    new_category = payload.category if payload.category is not None else specialization.category
    if not _can_manage_catalog_category(access, new_category):
        raise ForbiddenError("Нельзя перенести специализацию в дисциплину, которой вы не курируете")

    changes = payload.model_dump(exclude_unset=True)
    if "code" in changes:
        changes["code"] = changes["code"].strip().upper()
    if "name" in changes:
        changes["name"] = changes["name"].strip()
    updated = await specialization_crud.update(db, specialization, **changes)
    logger.info("%s изменил специализацию %s (%s)", access.user.username, updated.code, updated.name)
    return SpecializationRead.model_validate(updated)


@router.delete("/specializations/{specialization_id}", status_code=204)
async def delete_specialization(
    specialization_id: int,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> None:
    specialization = await specialization_crud.get_by_id(db, specialization_id)
    if specialization is None:
        raise NotFoundError("Специализация не найдена")
    if not _can_manage_catalog_category(access, specialization.category):
        raise ForbiddenError(
            "Редактировать каталог специализаций может администратор, либо DEP+/куратор своей дисциплины"
        )
    await specialization_crud.delete(db, specialization)
    logger.info("%s удалил специализацию %s из каталога", access.user.username, specialization.code)


@router.get("/members/{discord_id}/specializations", response_model=list[UserSpecializationRead])
async def list_member_specializations(
    discord_id: str,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[UserSpecializationRead]:
    """Видно всем авторизованным — часть личного дела, не только инструктору."""
    target = await user_crud.get_by_discord_id(db, discord_id)
    if target is None:
        return []
    grants = await specialization_crud.list_for_user(db, user_id=target.id)
    return [UserSpecializationRead.model_validate(g) for g in grants]


@router.post("/members/{discord_id}/specializations", response_model=UserSpecializationRead, status_code=201)
async def grant_specialization(
    discord_id: str,
    payload: GrantSpecializationRequest,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> UserSpecializationRead:
    if not access.can_grant_specializations:
        raise ForbiddenError("Выдавать специализации может только инструктор или администратор")

    target = await user_crud.get_by_discord_id(db, discord_id)
    if target is None:
        raise NotFoundError("Боец не найден")
    specialization = await specialization_crud.get_by_id(db, payload.specialization_id)
    if specialization is None:
        raise NotFoundError("Специализация не найдена")
    if not access.can_grant_specialization(specialization):
        raise ForbiddenError(
            f"Ваша роль инструктора не позволяет выдавать специализации категории «{specialization.category}»"
        )

    await _check_can_grant(db, target, specialization)

    grant_row = await specialization_crud.grant(
        db, user_id=target.id, specialization_id=specialization.id, granted_by_user_id=access.user.id
    )
    logger.info("%s выдал специализацию %s бойцу %s", access.user.username, specialization.code, discord_id)
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="specialization_grant",
        details=f"Выдал специализацию {specialization.code} — {specialization.name}",
        target_user_id=target.id,
        discipline=specialization.category if specialization.category in DISCIPLINE_CATEGORIES else None,
    )
    await notification_crud.create_personal_notification(
        db,
        target_user_id=target.id,
        title="Выдана специализация",
        body=f"Вам выдана специализация: {specialization.code} — {specialization.name}.",
        created_by=access.user.id,
    )
    return UserSpecializationRead.model_validate(grant_row)


@router.delete("/members/{discord_id}/specializations/{grant_id}", status_code=204)
async def revoke_specialization(
    discord_id: str,
    grant_id: int,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> None:
    if not access.can_grant_specializations:
        raise ForbiddenError("Снимать специализации может только инструктор или администратор")

    grant_row = await specialization_crud.get_grant_by_id(db, grant_id)
    target = await user_crud.get_by_discord_id(db, discord_id)
    if grant_row is None or target is None or grant_row.user_id != target.id:
        raise NotFoundError("Запись не найдена")

    specialization = await specialization_crud.get_by_id(db, grant_row.specialization_id)
    await specialization_crud.revoke(db, grant_row)
    logger.info("%s снял специализацию #%s у бойца %s", access.user.username, grant_row.specialization_id, discord_id)
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="specialization_revoke",
        details=f"Снял специализацию {specialization.code if specialization else '#' + str(grant_row.specialization_id)}",
        target_user_id=target.id,
        discipline=specialization.category if specialization and specialization.category in DISCIPLINE_CATEGORIES else None,
    )


# --- Временные запреты на обучение --------------------------------------------------


@router.get("/specialization-bans/active", response_model=list[SpecializationBanWithUserRead])
async def list_active_specialization_bans(
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[SpecializationBanWithUserRead]:
    """Сводный список всех, кто СЕЙЧАС не может обучаться (временно или
    навсегда) — для Инструкторской, чтобы не искать бойца по одному, чтобы
    узнать, есть ли на нём запрет."""
    if not access.can_grant_specializations:
        raise ForbiddenError("Список запретов на обучение доступен только инструктору или администратору")
    bans = await specialization_crud.list_active_bans(db)
    return [SpecializationBanWithUserRead.model_validate(b) for b in bans]


@router.get("/members/{discord_id}/specialization-bans", response_model=list[SpecializationBanRead])
async def list_member_specialization_bans(
    discord_id: str,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[SpecializationBanRead]:
    """Видно всем авторизованным — часть личного дела."""
    target = await user_crud.get_by_discord_id(db, discord_id)
    if target is None:
        return []
    bans = await specialization_crud.list_bans_for_user(db, user_id=target.id)
    return [SpecializationBanRead.model_validate(b) for b in bans]


@router.post("/members/{discord_id}/specialization-bans", response_model=SpecializationBanRead, status_code=201)
async def create_specialization_ban(
    discord_id: str,
    payload: SpecializationBanCreate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> SpecializationBanRead:
    specialization = None
    if payload.specialization_id is not None:
        specialization = await specialization_crud.get_by_id(db, payload.specialization_id)
        if specialization is None:
            raise NotFoundError("Специализация не найдена")

    # Серьёзное решение — рядовому инструктору недоступно. По конкретной
    # дисциплинарной специализации может DEP+/куратор этой ветки; запрет "на
    # всё обучение" (specialization_id не указан) или не-дисциплинарная
    # специализация — только администратор.
    allowed = access.is_admin or (
        specialization is not None
        and specialization.category in DISCIPLINE_CATEGORIES
        and access.is_discipline_deputy(specialization.category)
    )
    if not allowed:
        raise ForbiddenError("Запрет на обучение может выставить DEP+/куратор своей дисциплины или администратор")

    target = await user_crud.get_by_discord_id(db, discord_id)
    if target is None:
        raise NotFoundError("Боец не найден")

    ban = await specialization_crud.create_ban(
        db,
        user_id=target.id,
        specialization_id=payload.specialization_id,
        until_date=payload.until_date,
        reason=payload.reason,
        created_by_user_id=access.user.id,
    )
    until_label = payload.until_date.isoformat() if payload.until_date else "навсегда"
    logger.info("%s выставил запрет на обучение бойцу %s до %s", access.user.username, discord_id, until_label)
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="specialization_ban_create",
        details=f"Запрет на обучение до {until_label}" + (f" — {payload.reason}" if payload.reason else ""),
        target_user_id=target.id,
        discipline=specialization.category if specialization is not None and specialization.category in DISCIPLINE_CATEGORIES else None,
    )
    return SpecializationBanRead.model_validate(ban)


@router.delete("/members/{discord_id}/specialization-bans/{ban_id}", status_code=204)
async def delete_specialization_ban(
    discord_id: str,
    ban_id: int,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> None:
    ban = await specialization_crud.get_ban_by_id(db, ban_id)
    target = await user_crud.get_by_discord_id(db, discord_id)
    if ban is None or target is None or ban.user_id != target.id:
        raise NotFoundError("Запись не найдена")

    specialization = (
        await specialization_crud.get_by_id(db, ban.specialization_id) if ban.specialization_id is not None else None
    )
    allowed = access.is_admin or (
        specialization is not None
        and specialization.category in DISCIPLINE_CATEGORIES
        and access.is_discipline_deputy(specialization.category)
    )
    if not allowed:
        raise ForbiddenError("Снять запрет на обучение может DEP+/куратор своей дисциплины или администратор")

    await specialization_crud.delete_ban(db, ban)
    logger.info("%s снял запрет на обучение у бойца %s раньше срока", access.user.username, discord_id)


# --- Роли инструкторов (Discord-роль -> дисциплина/"учит всему") --------------------


@router.get("/instructor-roles", response_model=list[InstructorRoleRead])
async def list_instructor_roles(
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[InstructorRoleRead]:
    if not access.is_admin:
        raise ForbiddenError("Настройка ролей инструкторов доступна только администратору")
    rows = await specialization_crud.list_instructor_roles(db)
    return [InstructorRoleRead.model_validate(r) for r in rows]


@router.post("/instructor-roles", response_model=InstructorRoleRead, status_code=201)
async def create_instructor_role(
    payload: InstructorRoleCreate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> InstructorRoleRead:
    if not access.is_admin:
        raise ForbiddenError("Настройка ролей инструкторов доступна только администратору")
    if not payload.can_teach_all and payload.discipline is None:
        raise AppError("Укажите дисциплину, либо включите «учит всему»")
    if payload.can_teach_all and payload.discipline is not None:
        raise AppError("«Учит всему» и конкретная дисциплина одновременно не имеют смысла")

    if payload.tier != "instructor" and payload.can_teach_all:
        raise AppError("«Учит всему» — только обычный инструктор (DEP/CU всегда привязаны к конкретной дисциплине)")

    row = await specialization_crud.create_instructor_role(
        db,
        discord_role_id=payload.discord_role_id.strip(),
        label=payload.label.strip(),
        discipline=payload.discipline,
        can_teach_all=payload.can_teach_all,
        tier=payload.tier,
    )
    logger.info(
        "%s добавил роль инструктора «%s» (%s, %s)",
        access.user.username,
        row.label,
        "учит всему" if row.can_teach_all else row.discipline,
        row.tier,
    )
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="instructor_role_create",
        details=f"Добавил роль инструктора «{row.label}» ({'учит всему' if row.can_teach_all else row.discipline})",
    )
    return InstructorRoleRead.model_validate(row)


@router.delete("/instructor-roles/{instructor_role_id}", status_code=204)
async def delete_instructor_role(
    instructor_role_id: int,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> None:
    if not access.is_admin:
        raise ForbiddenError("Настройка ролей инструкторов доступна только администратору")
    row = await specialization_crud.get_instructor_role_by_id(db, instructor_role_id)
    if row is None:
        raise NotFoundError("Роль инструктора не найдена")
    await specialization_crud.delete_instructor_role(db, row)
    logger.info("%s удалил роль инструктора «%s»", access.user.username, row.label)
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="instructor_role_delete",
        details=f"Удалил роль инструктора «{row.label}»",
    )
