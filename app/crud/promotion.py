from datetime import datetime, timezone

from sqlalchemy import delete as sa_delete
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.events import event_bus
from app.crud import notification as notification_crud
from app.crud import points_adjustment as points_adjustment_crud
from app.crud import rank as rank_crud
from app.crud import regiment as regiment_crud
from app.crud import regiment_commander as regiment_commander_crud
from app.crud import report as report_crud
from app.crud import report_category as report_category_crud
from app.crud import report_participant as report_participant_crud
from app.crud import reprimand as reprimand_crud
from app.crud import user as user_crud
from app.exceptions import AppError
from app.models.promotion import (
    PromotionCategoryRequirement,
    PromotionRequest,
    PromotionRequirement,
    PromotionRequirementOverride,
)
from app.models.regiment import Regiment
from app.models.report import Report, ReportStatus
from app.models.report_category import ReportCategory
from app.models.user import User

_REQUEST_LOAD_OPTIONS = [
    selectinload(PromotionRequest.user).selectinload(User.rank),
    selectinload(PromotionRequest.from_rank),
    selectinload(PromotionRequest.to_rank),
    selectinload(PromotionRequest.decided_by_user),
]


async def get_requirements_for_regiment(db: AsyncSession, regiment_id: int) -> list[PromotionRequirement]:
    result = await db.execute(select(PromotionRequirement).where(PromotionRequirement.regiment_id == regiment_id))
    return list(result.scalars().all())


async def _get_requirement_row(db: AsyncSession, *, regiment_id: int, rank_id: int) -> PromotionRequirement | None:
    result = await db.execute(
        select(PromotionRequirement).where(
            PromotionRequirement.regiment_id == regiment_id, PromotionRequirement.rank_id == rank_id
        )
    )
    return result.scalar_one_or_none()


async def get_points_required(db: AsyncSession, *, regiment_id: int, rank_id: int) -> int:
    """Итоговое требование по баллам = админская база + командирская надбавка."""
    row = await _get_requirement_row(db, regiment_id=regiment_id, rank_id=rank_id)
    if row is None:
        return 0
    return row.admin_points_required + row.points_required


async def set_points_required(db: AsyncSession, *, regiment_id: int, rank_id: int, points_required: int) -> None:
    """Командирская надбавка сверх админской базы (admin_points_required не трогает)."""
    row = await _get_requirement_row(db, regiment_id=regiment_id, rank_id=rank_id)
    if row is None:
        row = PromotionRequirement(regiment_id=regiment_id, rank_id=rank_id, points_required=points_required)
        db.add(row)
    else:
        row.points_required = points_required
    await db.commit()


async def set_admin_points_required(db: AsyncSession, *, regiment_id: int, rank_id: int, points_required: int) -> None:
    """Админская база — командир её изменить не может, только оставить или докинуть
    сверху через set_points_required."""
    row = await _get_requirement_row(db, regiment_id=regiment_id, rank_id=rank_id)
    if row is None:
        row = PromotionRequirement(regiment_id=regiment_id, rank_id=rank_id, admin_points_required=points_required)
        db.add(row)
    else:
        row.admin_points_required = points_required
    await db.commit()


async def bulk_set_admin_points_required(
    db: AsyncSession, *, regiment_ids: list[int], rank_id: int, points_required: int
) -> None:
    """Применить одну и ту же админскую базу баллов сразу к нескольким/всем
    формированиям одним действием."""
    for regiment_id in regiment_ids:
        await set_admin_points_required(db, regiment_id=regiment_id, rank_id=rank_id, points_required=points_required)


async def sum_approved_points(db: AsyncSession, *, user_id: int, since=None) -> int:
    """Баллы за свои одобренные рапорты + баллы за участие в чужих (ростер-поля,
    см. app/crud/report_participant.py) + ручные начисления администрации — итог
    засчитывается на повышение.

    since — считать только с этой даты (обычно user.rank_assigned_at): баллы
    обнуляются при каждом повышении, не накапливаются за всю карьеру."""
    query = select(func.coalesce(func.sum(Report.points), 0)).where(
        Report.user_id == user_id, Report.status == ReportStatus.APPROVED
    )
    if since is not None:
        query = query.where(Report.created_at >= since)
    result = await db.execute(query)
    own_points = int(result.scalar_one())
    participant_points = await report_participant_crud.sum_points_for_user(db, user_id=user_id, since=since)
    adjustment_points = await points_adjustment_crud.sum_for_user(db, user_id=user_id, since=since)
    return own_points + participant_points + adjustment_points


async def get_pending_for_user(db: AsyncSession, *, user_id: int) -> PromotionRequest | None:
    result = await db.execute(
        select(PromotionRequest)
        .where(PromotionRequest.user_id == user_id, PromotionRequest.status == "pending")
        .options(*_REQUEST_LOAD_OPTIONS)
    )
    return result.scalar_one_or_none()


async def list_pending(db: AsyncSession, *, regiment_ids: set[int] | None) -> list[PromotionRequest]:
    """regiment_ids=None — все формирования (админ/высшее командование)."""
    query = select(PromotionRequest).where(PromotionRequest.status == "pending").options(*_REQUEST_LOAD_OPTIONS)
    if regiment_ids is not None:
        query = query.where(PromotionRequest.regiment_id.in_(regiment_ids))
    query = query.order_by(PromotionRequest.created_at)
    result = await db.execute(query)
    return list(result.scalars().all())


async def get_request_by_id(db: AsyncSession, request_id: int) -> PromotionRequest | None:
    return await db.get(PromotionRequest, request_id, options=_REQUEST_LOAD_OPTIONS, populate_existing=True)


async def list_decided_for_user(db: AsyncSession, *, user_id: int) -> list[PromotionRequest]:
    """История повышений — заявки, по которым уже принято решение (approved/rejected),
    для личной страницы "карьера"."""
    query = (
        select(PromotionRequest)
        .where(PromotionRequest.user_id == user_id, PromotionRequest.status != "pending")
        .options(*_REQUEST_LOAD_OPTIONS)
        .order_by(PromotionRequest.decided_at.desc())
    )
    result = await db.execute(query)
    return list(result.scalars().all())


async def decide(db: AsyncSession, request: PromotionRequest, *, approve: bool, decided_by: int) -> PromotionRequest:
    # Защита от повторного решения (двойной клик/повтор запроса) — без неё
    # повторное approve на уже одобренной заявке молча перезаписывает
    # rank_assigned_at (обнуляя прогресс по набранным баллам) и может откатить
    # звание бойца назад, если он уже получил более новое повышение
    if request.status != "pending":
        raise AppError("Заявка уже решена — повторное решение по ней невозможно")

    request.status = "approved" if approve else "rejected"
    request.decided_by = decided_by
    request.decided_at = datetime.now(timezone.utc)

    if approve:
        user = await db.get(User, request.user_id)
        user.rank_id = request.to_rank_id
        user.rank_assigned_at = datetime.now(timezone.utc)
        # Обычное одобрение заявки — не "досрочное" ручное повышение, снимок
        # (кто/почему) от предыдущего ручного изменения звания больше не актуален
        user.early_promoted_by_username = None
        user.early_promotion_reason = None

    mirror_report_changed = False
    if request.mirror_report_id is not None:
        decider = await db.get(User, decided_by)
        mirror_report = await db.get(Report, request.mirror_report_id)
        if mirror_report is not None:
            mirror_report.status = ReportStatus.APPROVED if approve else ReportStatus.REJECTED
            mirror_report.updated_by = decided_by
            mirror_report.updated_by_rank_id = decider.rank_id if decider else None
            mirror_report_changed = True

    await db.commit()
    event_bus.publish("promotions")
    if mirror_report_changed:
        # статус зеркального рапорта (категория "Повышение"/"Понижение") меняется
        # в обход report_crud.update_status — публикуем и "reports" отдельно, иначе
        # открытая лента рапортов в другой вкладке не увидит это изменение
        event_bus.publish("reports")
    return await get_request_by_id(db, request.id)


async def check_and_create_promotion_request(
    db: AsyncSession, user: User, *, regiment_id: int | None = None
) -> PromotionRequest | None:
    """Проверяет, выполнил ли боец критерии для повышения (баллы + дни выслуги, без
    непогашенного выговора), и если да — создаёт заявку. Ничего не делает, если заявка
    уже есть, критерии не выполнены, или невозможно определить формирование.

    regiment_id — если передан явно (например, командир уже открыл личное дело
    конкретного бойца своего формирования), используется вместо поиска по
    user.roles. user.roles — это снимок Discord-ролей на момент последнего входа
    САМОГО бойца на сайт; у бойцов, которых ни разу не открывали через личный
    вход (ими управляют только через веб-панель), это поле всегда пустое, и
    поиск формирования по ролям никогда бы не сработал."""
    if user.rank_id is None:
        return None

    existing = await get_pending_for_user(db, user_id=user.id)
    if existing is not None:
        return None

    if await reprimand_crud.has_active_reprimand(db, user_id=user.id):
        return None

    next_rank = await rank_crud.get_next_rank(db, user.rank_id)
    if next_rank is None:
        return None

    if regiment_id is not None:
        regiment = await db.get(Regiment, regiment_id)
    else:
        result = await db.execute(select(Regiment))
        regiments = list(result.scalars().all())
        role_ids = set(user.roles)
        regiment = next((r for r in regiments if r.discord_role_id in role_ids), None)
    if regiment is None:
        return None

    days_required = rank_crud.effective_tenure_days(next_rank)
    if days_required is not None:
        if user.rank_assigned_at is None:
            return None
        days_in_rank = (datetime.now(timezone.utc) - user.rank_assigned_at).days
        if days_in_rank < days_required:
            return None

    points_required = await get_points_required(db, regiment_id=regiment.id, rank_id=next_rank.id)
    points_current = await sum_approved_points(db, user_id=user.id, since=user.rank_assigned_at)
    if points_current < points_required:
        return None

    category_statuses = await get_category_requirement_statuses(
        db, regiment_id=regiment.id, rank_id=next_rank.id, user_id=user.id
    )
    if any(not status.satisfied for status in category_statuses):
        return None

    request = PromotionRequest(
        user_id=user.id,
        regiment_id=regiment.id,
        from_rank_id=user.rank_id,
        to_rank_id=next_rank.id,
        tenure_started_at=user.rank_assigned_at,
    )
    db.add(request)
    try:
        await db.commit()
    except IntegrityError:
        # Гонка: два рапорта, дающих право на повышение, одобрили почти
        # одновременно — оба прошли проверку "нет открытой заявки" до того, как
        # первый закоммитился. Уникальный индекс по (user_id) WHERE pending не
        # даёт завести вторую — тут просто отступаем, первая заявка уже есть.
        await db.rollback()
        return None

    # Дублируем заявку рапортом в системной категории "Повышение" — так её видно
    # сразу в обычной ленте рапортов, а не только на отдельной странице "Повышения"
    promotion_category = await report_category_crud.get_by_name(
        db, regiment_id=regiment.id, name=regiment_crud.PROMOTION_CATEGORY_NAME
    )
    if promotion_category is not None:
        current_rank = await rank_crud.get_by_id(db, user.rank_id)
        mirror_report = await report_crud.create_report(
            db,
            user_id=user.id,
            regiment_id=regiment.id,
            category_id=promotion_category.id,
            content=f"Заявка на повышение: {current_rank.code if current_rank else '—'} → {next_rank.code} — {next_rank.name}",
            status=ReportStatus.SUBMITTED,
            author_rank_id=user.rank_id,
        )
        request.mirror_report_id = mirror_report.id
        await db.commit()

    # Заявку на повышение самого командира формирования одобрить некому в самом
    # формировании (выше него там никого нет) — уведомляем высшее командование и
    # администраторов, чтобы заявка не "зависла" незамеченной.
    commanders = await regiment_commander_crud.get_by_regiment(db, regiment.id)
    is_commander = any(c.discord_id == user.discord_id and c.role_type == "commander" for c in commanders)
    if is_commander:
        recipients = await user_crud.list_admins_and_high_command(db)
        for recipient in recipients:
            if recipient.id == user.id:
                # Сам командир не одобряет себе повышение — уведомление о
                # "своей же заявке" ему не нужно, даже если он тоже админ/высшее командование
                continue
            await notification_crud.create_personal_notification(
                db,
                target_user_id=recipient.id,
                title="Заявка на повышение командира",
                body=f"{user.username} ({regiment.name}) ожидает повышения до {next_rank.code} — {next_rank.name}.",
                created_by=user.id,
            )

    event_bus.publish("promotions")
    return await get_request_by_id(db, request.id)


async def get_category_requirements(db: AsyncSession, regiment_id: int) -> list[PromotionCategoryRequirement]:
    result = await db.execute(
        select(PromotionCategoryRequirement)
        .where(PromotionCategoryRequirement.regiment_id == regiment_id)
        .options(selectinload(PromotionCategoryRequirement.category))
    )
    return list(result.scalars().all())


async def get_category_requirement_by_id(db: AsyncSession, requirement_id: int) -> PromotionCategoryRequirement | None:
    return await db.get(PromotionCategoryRequirement, requirement_id)


async def count_approved_reports_in_category(db: AsyncSession, *, user_id: int, category_id: int) -> int:
    result = await db.execute(
        select(func.count(Report.id)).where(
            Report.user_id == user_id, Report.category_id == category_id, Report.status == ReportStatus.APPROVED
        )
    )
    return int(result.scalar_one())


async def get_override(db: AsyncSession, *, user_id: int, requirement_id: int) -> PromotionRequirementOverride | None:
    result = await db.execute(
        select(PromotionRequirementOverride).where(
            PromotionRequirementOverride.user_id == user_id,
            PromotionRequirementOverride.requirement_id == requirement_id,
        )
    )
    return result.scalar_one_or_none()


async def set_override(
    db: AsyncSession, *, user_id: int, requirement_id: int, satisfied: bool, set_by: int
) -> PromotionRequirementOverride:
    override = await get_override(db, user_id=user_id, requirement_id=requirement_id)
    if override is None:
        override = PromotionRequirementOverride(
            user_id=user_id, requirement_id=requirement_id, satisfied=satisfied, set_by=set_by
        )
        db.add(override)
    else:
        override.satisfied = satisfied
        override.set_by = set_by
    await db.commit()
    await db.refresh(override)
    return override


class CategoryRequirementStatusData:
    """Промежуточный результат подсчёта одного категорийного требования для
    конкретного бойца — без привязки к pydantic-схеме (используется и в CRUD-логике
    check_and_create_promotion_request, и в API для сборки CategoryRequirementStatus)."""

    def __init__(
        self,
        *,
        requirement_id: int,
        category_id: int,
        category_name: str,
        count_required: int,
        count_current: int,
        is_mandatory: bool,
        satisfied: bool,
        overridden: bool,
    ) -> None:
        self.requirement_id = requirement_id
        self.category_id = category_id
        self.category_name = category_name
        self.count_required = count_required
        self.count_current = count_current
        self.is_mandatory = is_mandatory
        self.satisfied = satisfied
        self.overridden = overridden


async def get_category_requirement_statuses(
    db: AsyncSession, *, regiment_id: int, rank_id: int, user_id: int
) -> list[CategoryRequirementStatusData]:
    requirements = await get_category_requirements(db, regiment_id)
    relevant = [r for r in requirements if r.rank_id == rank_id]
    statuses: list[CategoryRequirementStatusData] = []
    for requirement in relevant:
        override = await get_override(db, user_id=user_id, requirement_id=requirement.id)
        count_current = await count_approved_reports_in_category(
            db, user_id=user_id, category_id=requirement.category_id
        )
        real_satisfied = count_current >= requirement.count_required
        satisfied = override.satisfied if override is not None else real_satisfied
        statuses.append(
            CategoryRequirementStatusData(
                requirement_id=requirement.id,
                category_id=requirement.category_id,
                category_name=requirement.category.name,
                count_required=requirement.count_required,
                count_current=count_current,
                is_mandatory=requirement.is_mandatory,
                satisfied=satisfied,
                overridden=override is not None,
            )
        )
    return statuses


async def create_local_category_requirement(
    db: AsyncSession, *, regiment_id: int, rank_id: int, category_id: int, count_required: int
) -> PromotionCategoryRequirement:
    requirement = PromotionCategoryRequirement(
        regiment_id=regiment_id,
        rank_id=rank_id,
        category_id=category_id,
        count_required=count_required,
        is_mandatory=False,
    )
    db.add(requirement)
    await db.commit()
    await db.refresh(requirement, attribute_names=["category"])
    return requirement


async def create_mandatory_category_requirement(
    db: AsyncSession,
    *,
    rank_id: int,
    category_name: str,
    category_fields: list[str],
    count_required: int,
    category_min_rank_id: int | None = None,
    category_commander_only: bool = False,
) -> list[PromotionCategoryRequirement]:
    """Обязательное требование — категория с этим именем гарантированно заводится
    (или переиспользуется, если уже есть) в КАЖДОМ формировании, и для каждого из них
    создаётся своя строка требования с общим mandatory_group_id, чтобы потом можно
    было снять требование одним действием сразу везде."""
    categories_by_regiment = await report_category_crud.get_or_create_in_all_regiments(
        db,
        name=category_name,
        fields=category_fields,
        min_rank_id=category_min_rank_id,
        commander_only=category_commander_only,
    )

    result = await db.execute(select(func.max(PromotionCategoryRequirement.mandatory_group_id)))
    group_id = (result.scalar_one_or_none() or 0) + 1

    created: list[PromotionCategoryRequirement] = []
    for regiment_id, category in categories_by_regiment.items():
        requirement = PromotionCategoryRequirement(
            regiment_id=regiment_id,
            rank_id=rank_id,
            category_id=category.id,
            count_required=count_required,
            is_mandatory=True,
            mandatory_group_id=group_id,
        )
        db.add(requirement)
        created.append(requirement)
    await db.commit()
    for requirement in created:
        await db.refresh(requirement, attribute_names=["category"])
    return created


async def get_mandatory_group(db: AsyncSession, group_id: int) -> list[PromotionCategoryRequirement]:
    result = await db.execute(
        select(PromotionCategoryRequirement)
        .where(PromotionCategoryRequirement.mandatory_group_id == group_id)
        .options(selectinload(PromotionCategoryRequirement.category))
    )
    return list(result.scalars().all())


async def update_mandatory_category_requirement(
    db: AsyncSession,
    *,
    group_id: int,
    rank_id: int,
    category_name: str,
    category_fields: list[str],
    count_required: int,
    category_min_rank_id: int | None = None,
    category_commander_only: bool = False,
) -> list[PromotionCategoryRequirement]:
    # updates all rows sharing this mandatory_group_id
    rows = await get_mandatory_group(db, group_id)
    if not rows:
        return []

    for row in rows:
        row.rank_id = rank_id
        row.count_required = count_required

    category_ids = {row.category_id for row in rows}
    for category_id in category_ids:
        category = await db.get(ReportCategory, category_id)
        if category is None:
            continue
        category.name = category_name
        if category_fields:
            category.fields = category_fields
        # unlike create: None here means "clear it", not "leave unchanged"
        category.min_rank_id = category_min_rank_id
        category.commander_only = category_commander_only

    await db.commit()
    for row in rows:
        await db.refresh(row, attribute_names=["category"])
    return rows


async def delete_category_requirement(db: AsyncSession, requirement: PromotionCategoryRequirement) -> None:
    """Локальное требование удаляется как есть; обязательное (is_mandatory) —
    удаляется сразу во всех формированиях по общему mandatory_group_id. Оверрайды,
    сделанные для этого требования (для любого бойца), удаляются вместе с ним —
    иначе внешний ключ promotion_requirement_overrides.requirement_id блокирует
    удаление строки, на которую они ссылаются.

    Категория рапортов, заведённая под это требование, тоже удаляется — но
    только если на неё больше никто не ссылается (ни другое требование, ни уже
    поданный рапорт), чтобы не копить в БД никем не используемые категории и не
    словить нарушение внешнего ключа на реальных данных."""
    if requirement.is_mandatory and requirement.mandatory_group_id is not None:
        result = await db.execute(
            select(PromotionCategoryRequirement).where(
                PromotionCategoryRequirement.mandatory_group_id == requirement.mandatory_group_id
            )
        )
        rows = list(result.scalars().all())
    else:
        rows = [requirement]

    requirement_ids = [row.id for row in rows]
    category_ids = {row.category_id for row in rows}
    await db.execute(
        sa_delete(PromotionRequirementOverride).where(
            PromotionRequirementOverride.requirement_id.in_(requirement_ids)
        )
    )
    for row in rows:
        await db.delete(row)
    await db.commit()

    for category_id in category_ids:
        other_requirements = await db.execute(
            select(func.count(PromotionCategoryRequirement.id)).where(
                PromotionCategoryRequirement.category_id == category_id
            )
        )
        if other_requirements.scalar_one() > 0:
            continue
        existing_reports = await db.execute(select(func.count(Report.id)).where(Report.category_id == category_id))
        if existing_reports.scalar_one() > 0:
            continue
        category = await db.get(ReportCategory, category_id)
        if category is not None:
            await db.delete(category)
    await db.commit()
