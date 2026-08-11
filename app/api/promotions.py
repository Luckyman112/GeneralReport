"""Система повышений: требования по баллам — свои у каждого формирования (правит
полноправный командир/высшее командование/админ), по дням выслуги — общие на весь
сервер (правит только высшее командование/админ, см. PATCH /ranks/tiers/{id}).
Автоматическая заявка на повышение создаётся, когда боец выполнил оба критерия и не
имеет непогашенного выговора; одобрить может заместитель/командир формирования,
высшее командование или администратор."""
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AccessContext, get_access_context
from app.crud import audit_log as audit_log_crud
from app.crud import jedi_trial as jedi_trial_crud
from app.crud import notification as notification_crud
from app.crud import promotion as promotion_crud
from app.crud import rank as rank_crud
from app.crud import regiment as regiment_crud
from app.crud import report as report_crud
from app.crud import report_category as report_category_crud
from app.crud import report_participant as report_participant_crud
from app.crud import reprimand as reprimand_crud
from app.crud import user as user_crud
from app.database import get_db
from app.exceptions import AppError, ForbiddenError, NotFoundError
from app.schemas.promotion import (
    AdminPointsUpdate,
    CategoryRequirementRead,
    CategoryRequirementStatus,
    LocalCategoryRequirementCreate,
    MandatoryCategoryRequirementCreate,
    MandatoryCategoryRequirementUpdate,
    PromotionRequestRead,
    PromotionRequirementRead,
    PromotionRequirementsUpdate,
    PromotionReviewRead,
    PromotionStatusRead,
    RequirementOverrideUpdate,
)
from app.schemas.rank import RankRead
from app.schemas.report import ReportRead
from app.schemas.user import UserBrief

logger = logging.getLogger(__name__)

router = APIRouter(tags=["promotions"])


@router.get("/regiments/{regiment_id}/promotion-requirements", response_model=list[PromotionRequirementRead])
async def get_promotion_requirements(
    regiment_id: int,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[PromotionRequirementRead]:
    """Видно любому, у кого есть доступ к формированию (боец — только на просмотр)."""
    if not (access.is_admin or access.is_high_command or regiment_id in access.own_regiment_ids):
        raise ForbiddenError("Нет доступа к этому формированию")
    rows = await promotion_crud.get_requirements_for_regiment(db, regiment_id)
    return [
        PromotionRequirementRead(
            rank_id=r.rank_id,
            admin_points_required=r.admin_points_required,
            points_required=r.points_required,
            total_points_required=r.admin_points_required + r.points_required,
        )
        for r in rows
    ]


@router.patch("/regiments/{regiment_id}/promotion-requirements", response_model=list[PromotionRequirementRead])
async def update_promotion_requirements(
    regiment_id: int,
    payload: PromotionRequirementsUpdate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[PromotionRequirementRead]:
    """Командирская надбавка сверх админской базы — правит только полноправный
    командир (не заместитель), высшее командование или администратор. Админскую базу
    не трогает, см. PATCH /promotion-requirements/admin."""
    if not access.is_full_commander_of(regiment_id):
        raise ForbiddenError("Изменять требования по баллам может только командир формирования")

    for item in payload.items:
        await promotion_crud.set_points_required(
            db, regiment_id=regiment_id, rank_id=item.rank_id, points_required=item.points_required
        )
    logger.info("%s обновил требования по баллам для формирования %s", access.user.username, regiment_id)

    rows = await promotion_crud.get_requirements_for_regiment(db, regiment_id)
    return [
        PromotionRequirementRead(
            rank_id=r.rank_id,
            admin_points_required=r.admin_points_required,
            points_required=r.points_required,
            total_points_required=r.admin_points_required + r.points_required,
        )
        for r in rows
    ]


@router.patch("/promotion-requirements/admin", response_model=list[PromotionRequirementRead])
async def update_admin_points_required(
    payload: AdminPointsUpdate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[PromotionRequirementRead]:
    """Админская база баллов — правит только администратор/высшее командование, не
    может быть изменена командиром (он может только докинуть сверху, см. PATCH
    /regiments/{id}/promotion-requirements). regiment_ids=None — применить сразу ко
    всем формированиям одним действием."""
    if not (access.is_admin or access.is_high_command):
        raise ForbiddenError("Изменять админскую базу баллов может только высшее командование или администратор")

    regiment_ids = payload.regiment_ids
    if regiment_ids is None:
        regiment_ids = [r.id for r in await regiment_crud.get_all(db)]

    for item in payload.items:
        await promotion_crud.bulk_set_admin_points_required(
            db, regiment_ids=regiment_ids, rank_id=item.rank_id, points_required=item.points_required
        )
    logger.info(
        "%s обновил админскую базу баллов для формирований %s", access.user.username, regiment_ids
    )
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="admin_points_update",
        details=f"Админская база баллов для формирований {regiment_ids}: {[i.model_dump() for i in payload.items]}",
    )

    result: list[PromotionRequirementRead] = []
    for regiment_id in regiment_ids:
        rows = await promotion_crud.get_requirements_for_regiment(db, regiment_id)
        result.extend(
            PromotionRequirementRead(
                rank_id=r.rank_id,
                admin_points_required=r.admin_points_required,
                points_required=r.points_required,
                total_points_required=r.admin_points_required + r.points_required,
            )
            for r in rows
        )
    return result


@router.get("/promotion-requests", response_model=list[PromotionRequestRead])
async def list_promotion_requests(
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[PromotionRequestRead]:
    """Заявки, ожидающие решения. Создатель/высшее командование видят все,
    обычный командир/заместитель — только по своим формированиям, у остальных
    список всегда пуст (не для них) — обычный администратор (не создатель) больше
    не входит в число тех, кто решает по заявкам, см. can_decide_promotion."""
    if access.is_founder or access.is_high_command:
        requests = await promotion_crud.list_pending(db, regiment_ids=None)
    elif access.commander_regiment_ids:
        # см. can_decide_promotion — командир/заместитель ЛЮБОГО формирования
        # решает и по 17-му Передовому Полку, значит должен видеть его заявки
        # в списке, иначе право есть, а увидеть заявку можно только по прямой ссылке
        regiment_ids = access.commander_regiment_ids | (
            {access.recruit_regiment_id} if access.recruit_regiment_id is not None else set()
        )
        requests = await promotion_crud.list_pending(db, regiment_ids=regiment_ids)
    else:
        requests = []
    return [PromotionRequestRead.model_validate(r) for r in requests]


@router.post("/promotion-requests/{request_id}/approve", response_model=PromotionRequestRead)
async def approve_promotion_request(
    request_id: int,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> PromotionRequestRead:
    request = await promotion_crud.get_request_by_id(db, request_id)
    if request is None:
        raise NotFoundError("Заявка не найдена")
    if not access.can_decide_promotion(request.regiment_id):
        raise ForbiddenError("Одобрить заявку может только командир формирования, высшее командование или создатель")
    if request.status != "pending":
        raise AppError("Заявка уже решена — повторное решение по ней невозможно")

    updated = await promotion_crud.decide(db, request, approve=True, decided_by=access.user.id)
    logger.info("%s одобрил заявку на повышение %s", access.user.username, request_id)
    await notification_crud.create_personal_notification(
        db,
        target_user_id=updated.user_id,
        title="Повышение одобрено",
        body=f"Вас повысили до звания {updated.to_rank.code} — {updated.to_rank.name}.",
        created_by=access.user.id,
    )
    return PromotionRequestRead.model_validate(updated)


@router.post("/promotion-requests/{request_id}/reject", response_model=PromotionRequestRead)
async def reject_promotion_request(
    request_id: int,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> PromotionRequestRead:
    request = await promotion_crud.get_request_by_id(db, request_id)
    if request is None:
        raise NotFoundError("Заявка не найдена")
    if not access.can_decide_promotion(request.regiment_id):
        raise ForbiddenError("Отклонить заявку может только командир формирования, высшее командование или создатель")
    if request.status != "pending":
        raise AppError("Заявка уже решена — повторное решение по ней невозможно")

    updated = await promotion_crud.decide(db, request, approve=False, decided_by=access.user.id)
    logger.info("%s отклонил заявку на повышение %s", access.user.username, request_id)
    await notification_crud.create_personal_notification(
        db,
        target_user_id=updated.user_id,
        title="Повышение отклонено",
        body=f"Заявка на звание {updated.to_rank.code} — {updated.to_rank.name} отклонена.",
        created_by=access.user.id,
    )
    return PromotionRequestRead.model_validate(updated)


@router.get(
    "/promotion-requests/{request_id}/review",
    response_model=PromotionReviewRead,
)
async def get_promotion_review(
    request_id: int,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> PromotionReviewRead:
    """Обзор заявки на повышение (ожидающей или уже решённой) — все рапорты бойца
    за период текущего звания и выполненные требования по категориям. Доступно
    командиру/заму этого формирования (в том числе для истории) и самому бойцу,
    о ком заявка (посмотреть, что зачлось в свою историю повышений). Тот же
    carve-out 17-го Передового Полка, что и на решение по заявке (см.
    can_decide_promotion) — иначе кто вправе решить по заявке рекрута, не
    смог бы открыть её обзор (баг-репорт)."""
    request = await promotion_crud.get_request_by_id(db, request_id)
    if request is None:
        raise NotFoundError("Заявка не найдена")
    if not access.can_decide_promotion(request.regiment_id) and request.user_id != access.user.id:
        raise ForbiddenError("Обзор доступен командиру формирования или самому бойцу")

    period_start = request.tenure_started_at
    period_end = request.decided_at or datetime.now(timezone.utc)
    if period_start:
        own_reports = await report_crud.list_since(db, user_id=request.user_id, since=period_start)
        participant_reports = await report_participant_crud.list_reports_since(
            db, user_id=request.user_id, since=period_start
        )
        reports_by_id = {r.id: r for r in own_reports}
        for r in participant_reports:
            reports_by_id.setdefault(r.id, r)
        reports = sorted(reports_by_id.values(), key=lambda r: r.created_at, reverse=True)
    else:
        reports = []
    category_statuses = await promotion_crud.get_category_requirement_statuses(
        db, regiment_id=request.regiment_id, rank_id=request.to_rank_id, user_id=request.user_id
    )

    return PromotionReviewRead(
        regiment_id=request.regiment_id,
        status=request.status,
        from_rank=RankRead.model_validate(request.from_rank) if request.from_rank else None,
        to_rank=RankRead.model_validate(request.to_rank),
        period_start=period_start,
        period_end=period_end,
        decided_by=UserBrief.model_validate(request.decided_by_user) if request.decided_by_user else None,
        decided_at=request.decided_at,
        reports=[ReportRead.model_validate(r) for r in reports],
        category_requirements=[
            CategoryRequirementStatus(
                requirement_id=s.requirement_id,
                category_id=s.category_id,
                category_name=s.category_name,
                count_required=s.count_required,
                count_current=s.count_current,
                is_mandatory=s.is_mandatory,
                satisfied=s.satisfied,
                overridden=s.overridden,
            )
            for s in category_statuses
        ],
    )


@router.get("/me/promotion-history", response_model=list[PromotionRequestRead])
async def get_my_promotion_history(
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[PromotionRequestRead]:
    """История своих решённых заявок на повышение (одобренные/отклонённые) —
    личная "карьера"."""
    requests = await promotion_crud.list_decided_for_user(db, user_id=access.user.id)
    return [PromotionRequestRead.model_validate(r) for r in requests]


@router.get("/me/promotion-status", response_model=PromotionStatusRead)
async def get_my_promotion_status(
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> PromotionStatusRead:
    """Личная статистика повышения — что не хватает для перехода на следующее
    звание. Заодно опportunistically проверяет и создаёт авто-заявку, если критерии
    уже выполнены (покрывает случай "просто дождался нужного числа дней")."""
    return await _compute_promotion_status(db, access.user)


async def _compute_promotion_status(
    db: AsyncSession, user, *, regiment_id: int | None = None
) -> PromotionStatusRead:
    """Общая логика для /me/promotion-status (сам боец) и обзора командиром
    прогресса конкретного бойца в его личном деле.

    regiment_id — если передан явно, формирование берётся по нему напрямую,
    а не поиском по user.roles (снимок Discord-ролей на момент последнего
    личного входа бойца на сайт — у бойцов, за которых профиль всегда вела
    только веб-панель, это поле пустое, и поиск по ролям ничего бы не нашёл)."""
    has_active_reprimand = await reprimand_crud.has_active_reprimand(db, user_id=user.id)

    if user.rank_id is None:
        return PromotionStatusRead(
            regiment_id=None,
            current_rank=None,
            next_rank=None,
            days_in_rank=None,
            days_required=None,
            points_current=0,
            points_required=0,
            has_active_reprimand=has_active_reprimand,
            is_eligible=False,
        )

    current_rank = await rank_crud.get_by_id(db, user.rank_id)
    next_rank = await rank_crud.get_next_rank(db, user.rank_id)

    if regiment_id is not None:
        regiment = await regiment_crud.get_by_id(db, regiment_id)
    else:
        regiments = await regiment_crud.get_all(db)
        role_ids = set(user.roles)
        regiment = next((r for r in regiments if r.discord_role_id in role_ids), None)

    days_in_rank = None
    if user.rank_assigned_at is not None:
        days_in_rank = (datetime.now(timezone.utc) - user.rank_assigned_at).days

    points_current = await promotion_crud.sum_approved_points(db, user_id=user.id, since=user.rank_assigned_at)

    if next_rank is None or regiment is None:
        return PromotionStatusRead(
            regiment_id=regiment.id if regiment else None,
            current_rank=RankRead.model_validate(current_rank) if current_rank else None,
            next_rank=None,
            days_in_rank=days_in_rank,
            days_required=None,
            points_current=points_current,
            points_required=0,
            has_active_reprimand=has_active_reprimand,
            is_eligible=False,
        )

    days_required = rank_crud.effective_tenure_days(next_rank)
    points_required = await promotion_crud.get_points_required(db, regiment_id=regiment.id, rank_id=next_rank.id)

    category_statuses = await promotion_crud.get_category_requirement_statuses(
        db, regiment_id=regiment.id, rank_id=next_rank.id, user_id=user.id
    )

    days_ok = days_required is None or (days_in_rank is not None and days_in_rank >= days_required)
    points_ok = points_current >= points_required
    categories_ok = all(status.satisfied for status in category_statuses)

    jedi_needs_trained_padawan = False
    if regiment.is_jedi_order and next_rank.code == "MST":
        jedi_needs_trained_padawan = not await jedi_trial_crud.has_trained_a_padawan(db, user_id=user.id)

    is_eligible = (
        days_ok and points_ok and categories_ok and not jedi_needs_trained_padawan and not has_active_reprimand
    )

    if is_eligible:
        await promotion_crud.check_and_create_promotion_request(db, user, regiment_id=regiment.id)

    pending_request = await promotion_crud.get_pending_for_user(db, user_id=user.id)

    return PromotionStatusRead(
        regiment_id=regiment.id,
        current_rank=RankRead.model_validate(current_rank) if current_rank else None,
        next_rank=RankRead.model_validate(next_rank),
        days_in_rank=days_in_rank,
        days_required=days_required,
        points_current=points_current,
        points_required=points_required,
        has_active_reprimand=has_active_reprimand,
        is_eligible=is_eligible,
        jedi_needs_trained_padawan=jedi_needs_trained_padawan,
        pending_request_id=pending_request.id if pending_request else None,
        category_requirements=[
            CategoryRequirementStatus(
                requirement_id=status.requirement_id,
                category_id=status.category_id,
                category_name=status.category_name,
                count_required=status.count_required,
                count_current=status.count_current,
                is_mandatory=status.is_mandatory,
                satisfied=status.satisfied,
                overridden=status.overridden,
            )
            for status in category_statuses
        ],
    )


@router.get(
    "/regiments/{regiment_id}/members/{discord_id}/promotion-status",
    response_model=PromotionStatusRead,
)
async def get_member_promotion_status(
    regiment_id: int,
    discord_id: str,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> PromotionStatusRead:
    """Та же сводка "что осталось до повышения", что боец видит для себя на
    Главной — только для конкретного бойца, в его личном деле. Доступно только
    командиру/заму этого формирования. Исключение — 17-й Передовой Полк: пока
    боец там числится, доступно командиру/заму ЛЮБОГО формирования (см.
    can_decide_promotion, тот же carve-out, что и на решение по заявке —
    иначе тот, кто вправе одобрить заявку рекрута, не смог бы даже увидеть
    его прогресс до повышения, баг-репорт)."""
    if not access.can_decide_promotion(regiment_id):
        raise ForbiddenError("Сводка по повышению доступна только командиру формирования")

    target = await user_crud.get_by_discord_id(db, discord_id)
    if target is None:
        raise NotFoundError("Участник не найден")

    return await _compute_promotion_status(db, target, regiment_id=regiment_id)


@router.get(
    "/regiments/{regiment_id}/promotion-category-requirements",
    response_model=list[CategoryRequirementRead],
)
async def get_category_requirements(
    regiment_id: int,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[CategoryRequirementRead]:
    """Видно любому, у кого есть доступ к формированию (боец — только на просмотр)."""
    if not (access.is_admin or access.is_high_command or regiment_id in access.own_regiment_ids):
        raise ForbiddenError("Нет доступа к этому формированию")
    rows = await promotion_crud.get_category_requirements(db, regiment_id)
    return [
        CategoryRequirementRead(
            id=r.id,
            regiment_id=r.regiment_id,
            rank_id=r.rank_id,
            category_id=r.category_id,
            count_required=r.count_required,
            is_mandatory=r.is_mandatory,
            mandatory_group_id=r.mandatory_group_id,
        )
        for r in rows
    ]


@router.post(
    "/regiments/{regiment_id}/promotion-category-requirements",
    response_model=CategoryRequirementRead,
)
async def create_local_category_requirement(
    regiment_id: int,
    payload: LocalCategoryRequirementCreate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> CategoryRequirementRead:
    """Локальное требование "нужно N рапортов категории X" — заводит только
    полноправный командир своего формирования, на основе категорий, которые уже
    существуют именно в этом формировании."""
    if not access.is_full_commander_of(regiment_id):
        raise ForbiddenError("Заводить требования по категориям может только командир формирования")

    category = await report_category_crud.get_by_id(db, payload.category_id)
    if category is None or category.regiment_id != regiment_id:
        raise NotFoundError("Категория не найдена в этом формировании")

    requirement = await promotion_crud.create_local_category_requirement(
        db,
        regiment_id=regiment_id,
        rank_id=payload.rank_id,
        category_id=payload.category_id,
        count_required=payload.count_required,
    )
    return CategoryRequirementRead(
        id=requirement.id,
        regiment_id=requirement.regiment_id,
        rank_id=requirement.rank_id,
        category_id=requirement.category_id,
        count_required=requirement.count_required,
        is_mandatory=requirement.is_mandatory,
        mandatory_group_id=requirement.mandatory_group_id,
    )


@router.post(
    "/promotion-category-requirements/mandatory",
    response_model=list[CategoryRequirementRead],
)
async def create_mandatory_category_requirement(
    payload: MandatoryCategoryRequirementCreate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[CategoryRequirementRead]:
    """Обязательное требование сразу для ВСЕХ формирований — заводит только
    высшее командование/администратор. Если категории с таким именем ещё нет в
    формировании, она будет создана там автоматически с переданным шаблоном полей."""
    if not (access.is_admin or access.is_high_command):
        raise ForbiddenError("Заводить обязательные требования может только высшее командование или администратор")

    rows = await promotion_crud.create_mandatory_category_requirement(
        db,
        rank_id=payload.rank_id,
        category_name=payload.category_name,
        category_fields=payload.category_fields,
        count_required=payload.count_required,
        category_min_rank_id=payload.category_min_rank_id,
        category_commander_only=payload.category_commander_only,
    )
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="mandatory_requirement_create",
        details=f"Завёл обязательное требование «{payload.category_name}» ({payload.count_required}) для звания {payload.rank_id} во всех формированиях",
    )
    return [
        CategoryRequirementRead(
            id=r.id,
            regiment_id=r.regiment_id,
            rank_id=r.rank_id,
            category_id=r.category_id,
            count_required=r.count_required,
            is_mandatory=r.is_mandatory,
            mandatory_group_id=r.mandatory_group_id,
        )
        for r in rows
    ]


@router.patch(
    "/promotion-category-requirements/mandatory/{group_id}",
    response_model=list[CategoryRequirementRead],
)
async def update_mandatory_category_requirement(
    group_id: int,
    payload: MandatoryCategoryRequirementUpdate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[CategoryRequirementRead]:
    # edits requirement across all regiments sharing mandatory_group_id
    if not (access.is_admin or access.is_high_command):
        raise ForbiddenError("Изменять обязательные требования может только высшее командование или администратор")

    rows = await promotion_crud.update_mandatory_category_requirement(
        db,
        group_id=group_id,
        rank_id=payload.rank_id,
        category_name=payload.category_name,
        category_fields=payload.category_fields,
        count_required=payload.count_required,
        category_min_rank_id=payload.category_min_rank_id,
        category_commander_only=payload.category_commander_only,
    )
    if not rows:
        raise NotFoundError("Обязательное требование не найдено")
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="mandatory_requirement_update",
        details=f"Изменил обязательное требование «{payload.category_name}» ({payload.count_required}) для звания {payload.rank_id}",
    )
    return [
        CategoryRequirementRead(
            id=r.id,
            regiment_id=r.regiment_id,
            rank_id=r.rank_id,
            category_id=r.category_id,
            count_required=r.count_required,
            is_mandatory=r.is_mandatory,
            mandatory_group_id=r.mandatory_group_id,
        )
        for r in rows
    ]


@router.delete("/promotion-category-requirements/{requirement_id}", status_code=204)
async def delete_category_requirement(
    requirement_id: int,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> None:
    """Локальное требование удаляет командир своего формирования; обязательное
    (заведённое администрацией) убрать может только высшее командование/админ — и
    оно снимается сразу во всех формированиях."""
    requirement = await promotion_crud.get_category_requirement_by_id(db, requirement_id)
    if requirement is None:
        raise NotFoundError("Требование не найдено")

    if requirement.is_mandatory:
        if not (access.is_admin or access.is_high_command):
            raise ForbiddenError("Снять обязательное требование может только высшее командование или администратор")
        await audit_log_crud.log(
            db,
            actor_user_id=access.user.id,
            actor_is_admin=access.is_admin,
            action="mandatory_requirement_delete",
            details=f"Снял обязательное требование #{requirement_id} (группа {requirement.mandatory_group_id})",
        )
    elif not access.is_full_commander_of(requirement.regiment_id):
        raise ForbiddenError("Снять требование может только командир формирования")

    await promotion_crud.delete_category_requirement(db, requirement)


@router.post("/promotion-category-requirements/override", status_code=204)
async def override_category_requirement(
    payload: RequirementOverrideUpdate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> None:
    """Ручное переопределение админом/высшим командованием: считать ли требование
    выполненным для конкретного бойца, независимо от реального числа рапортов."""
    if not (access.is_admin or access.is_high_command):
        raise ForbiddenError("Переопределять критерии может только высшее командование или администратор")

    requirement = await promotion_crud.get_category_requirement_by_id(db, payload.requirement_id)
    if requirement is None:
        raise NotFoundError("Требование не найдено")

    target = await user_crud.get_by_discord_id(db, payload.target_discord_id)
    if target is None:
        raise NotFoundError("Пользователь не найден")

    await promotion_crud.set_override(
        db, user_id=target.id, requirement_id=requirement.id, satisfied=payload.satisfied, set_by=access.user.id
    )
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="requirement_override",
        details=f"Переопределил требование #{requirement.id} для {payload.target_discord_id}: satisfied={payload.satisfied}",
    )
