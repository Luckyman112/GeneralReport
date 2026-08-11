import uuid
from datetime import datetime, timezone

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.report import Report, ReportStatus
from app.models.report_category import ReportCategory
from app.models.report_regiment_decision import ReportRegimentDecision
from app.models.user import User

_LOAD_OPTIONS = [
    selectinload(Report.images),
    selectinload(Report.author).selectinload(User.rank),
    selectinload(Report.updated_by_user).selectinload(User.rank),
    selectinload(Report.target_rank),
    selectinload(Report.author_rank),
    selectinload(Report.updated_by_rank),
    selectinload(Report.category),
]


async def create_report(
    db: AsyncSession,
    *,
    user_id: int,
    regiment_id: int,
    category_id: int | None,
    content: str,
    status: ReportStatus,
    points: int | None = None,
    author_rank_id: int | None = None,
    participant_discord_ids: list[str] | None = None,
    target_discord_id: str | None = None,
    target_username: str | None = None,
    target_regiment_id: int | None = None,
    target_service_id: str | None = None,
    target_rank_id: int | None = None,
    target_callsign: str | None = None,
    punishment_type: str | None = None,
    punishment_other_text: str | None = None,
    punishment_amount: str | None = None,
    training_specialization_ids: list[int] | None = None,
    mirror_of_report_id: uuid.UUID | None = None,
) -> Report:
    report = Report(
        user_id=user_id,
        regiment_id=regiment_id,
        category_id=category_id,
        content=content,
        status=status,
        points=points,
        author_rank_id=author_rank_id,
        participant_discord_ids=participant_discord_ids or [],
        target_discord_id=target_discord_id,
        target_username=target_username,
        target_regiment_id=target_regiment_id,
        target_service_id=target_service_id,
        target_rank_id=target_rank_id,
        target_callsign=target_callsign,
        punishment_type=punishment_type,
        punishment_other_text=punishment_other_text,
        punishment_amount=punishment_amount,
        training_specialization_ids=training_specialization_ids or [],
        mirror_of_report_id=mirror_of_report_id,
    )
    db.add(report)
    await db.commit()
    return await get_by_id(db, report.id)


async def list_since(db: AsyncSession, *, user_id: int, since, status: ReportStatus | None = None) -> list[Report]:
    """Рапорты пользователя начиная с указанной даты (используется для обзора
    повышения — рапорты за текущее звание, с даты назначения этого звания).
    Системная копия заявки на повышение (категория is_promotion) сюда не
    попадает — это не рапорт, поданный бойцом, и не должна засчитываться в
    статистику для следующего повышения (см. решение пользователя, аналогично
    app/crud/stats.py::_exclude_promotion_mirrors)."""
    query = (
        select(Report)
        .outerjoin(ReportCategory, Report.category_id == ReportCategory.id)
        .where(
            Report.user_id == user_id,
            Report.created_at >= since,
            or_(ReportCategory.id.is_(None), ReportCategory.is_promotion.is_(False)),
        )
        .options(*_LOAD_OPTIONS)
    )
    if status is not None:
        query = query.where(Report.status == status)
    query = query.order_by(Report.created_at.desc())
    result = await db.execute(query)
    return list(result.scalars().all())


async def get_by_id(db: AsyncSession, report_id: uuid.UUID) -> Report | None:
    # populate_existing=True обязателен: без него db.get() при уже загруженном
    # в сессию объекте (например, только что созданном) вернёт его из identity map,
    # проигнорировав selectinload, и report.images останется неинициализированным —
    # что уронит сериализацию с MissingGreenlet при попытке лениво его подгрузить.
    return await db.get(
        Report,
        report_id,
        options=_LOAD_OPTIONS,
        populate_existing=True,
    )


async def list_reports(
    db: AsyncSession,
    *,
    regiment_ids: list[int] | None = None,
    user_id: int | None = None,
    category_id: int | None = None,
    status: ReportStatus | None = None,
    search: str | None = None,
    since: datetime | None = None,
    visible_target_regiment_ids: set[int] | None = None,
    joint_decision_regiment_ids: set[int] | None = None,
    limit: int | None = None,
    offset: int = 0,
    include_deleted: bool = False,
) -> list[Report]:
    """Список рапортов с опциональными фильтрами.

    regiment_ids=None означает "без ограничения по формированиям" (для администратора),
    иначе рапорты ограничиваются переданным списком формирований (доступных пользователю).

    visible_target_regiment_ids — дополнительно (через OR) показывает рапорты о
    задержании (target_regiment_id), даже если их автор не из этих формирований и
    не сам пользователь — так рапорт о задержании бойца своего формирования виден
    всем бойцам этого формирования, а не только автору/командиру формирования-автора.
    Черновики сюда не попадают (ещё не оформленное обвинение не должно "утекать").

    joint_decision_regiment_ids — дополнительно (через OR) показывает совместные
    рапорты (см. ReportCategory.is_joint), у которых есть решение одного из этих
    формирований — иначе командир формирования-участника, не состоящий в
    формировании-подателе (обычно Штаб), вообще не увидел бы рапорт.

    include_deleted — показать и мягко удалённые (аннулированные) рапорты тоже
    (см. app/api/regiments.py::get_member_reports — в личном деле аннулирование
    должно быть видно, а не бесследно исчезать)."""
    query = select(Report).options(*_LOAD_OPTIONS).order_by(Report.created_at.desc())

    base_conditions = []
    if regiment_ids is not None:
        base_conditions.append(Report.regiment_id.in_(regiment_ids))
    if user_id is not None:
        base_conditions.append(Report.user_id == user_id)

    or_clauses = []
    if base_conditions:
        or_clauses.append(and_(*base_conditions))
    if visible_target_regiment_ids:
        or_clauses.append(
            and_(
                Report.target_regiment_id.in_(visible_target_regiment_ids),
                Report.status != ReportStatus.DRAFT,
            )
        )
    if joint_decision_regiment_ids:
        or_clauses.append(
            Report.id.in_(
                select(ReportRegimentDecision.report_id).where(
                    ReportRegimentDecision.regiment_id.in_(joint_decision_regiment_ids)
                )
            )
        )
    if or_clauses:
        query = query.where(or_clauses[0] if len(or_clauses) == 1 else or_(*or_clauses))

    if category_id is not None:
        query = query.where(Report.category_id == category_id)
    if status is not None:
        query = query.where(Report.status == status)
    elif not include_deleted:
        # По умолчанию не показываем удалённые рапорты, если статус не запрошен явно
        query = query.where(Report.status != ReportStatus.DELETED)

    if search:
        query = query.where(Report.content.ilike(f"%{search}%"))
    if since is not None:
        query = query.where(Report.created_at >= since)

    if limit is not None:
        query = query.limit(limit).offset(offset)

    result = await db.execute(query)
    return list(result.scalars().all())


async def list_for_category_public(db: AsyncSession, *, category_id: int) -> list[Report]:
    """Все рапорты категории, кроме черновиков и аннулированных — для публичных
    витрин (сейчас единственный случай: список рапортов «Курс молодого бойца»,
    открытый любому бойцу независимо от формирования, см.
    app/api/reports.py::list_recruit_training_reports). Черновики сюда не
    попадают — иначе был бы виден чужой неотправленный рапорт."""
    query = (
        select(Report)
        .options(*_LOAD_OPTIONS)
        .where(
            Report.category_id == category_id,
            Report.status.not_in([ReportStatus.DRAFT, ReportStatus.DELETED]),
        )
        .order_by(Report.created_at.desc())
    )
    result = await db.execute(query)
    return list(result.scalars().all())


async def last_report_at_by_user_ids(db: AsyncSession, user_ids: list[int]) -> dict[int, datetime]:
    """Дата последнего рапорта каждого бойца (любой статус кроме DELETED) —
    для колонки "Последний рапорт" в ростере (см. решение пользователя: удобно
    видеть активность). Один GROUP BY запрос на весь список сразу, не N+1."""
    if not user_ids:
        return {}
    result = await db.execute(
        select(Report.user_id, func.max(Report.created_at))
        .where(Report.user_id.in_(user_ids), Report.status != ReportStatus.DELETED)
        .group_by(Report.user_id)
    )
    return dict(result.all())


async def count_reports(
    db: AsyncSession,
    *,
    regiment_ids: list[int] | None = None,
    user_id: int | None = None,
    category_id: int | None = None,
    status: ReportStatus | None = None,
    search: str | None = None,
    since: datetime | None = None,
    visible_target_regiment_ids: set[int] | None = None,
    joint_decision_regiment_ids: set[int] | None = None,
) -> int:
    """Тот же набор фильтров, что и list_reports — для отображения "Показать ещё"
    на фронте (сколько всего рапортов помимо уже загруженных)."""
    query = select(func.count()).select_from(Report)

    base_conditions = []
    if regiment_ids is not None:
        base_conditions.append(Report.regiment_id.in_(regiment_ids))
    if user_id is not None:
        base_conditions.append(Report.user_id == user_id)

    or_clauses = []
    if base_conditions:
        or_clauses.append(and_(*base_conditions))
    if visible_target_regiment_ids:
        or_clauses.append(
            and_(
                Report.target_regiment_id.in_(visible_target_regiment_ids),
                Report.status != ReportStatus.DRAFT,
            )
        )
    if joint_decision_regiment_ids:
        or_clauses.append(
            Report.id.in_(
                select(ReportRegimentDecision.report_id).where(
                    ReportRegimentDecision.regiment_id.in_(joint_decision_regiment_ids)
                )
            )
        )
    if or_clauses:
        query = query.where(or_clauses[0] if len(or_clauses) == 1 else or_(*or_clauses))

    if category_id is not None:
        query = query.where(Report.category_id == category_id)
    if status is not None:
        query = query.where(Report.status == status)
    else:
        query = query.where(Report.status != ReportStatus.DELETED)

    if search:
        query = query.where(Report.content.ilike(f"%{search}%"))
    if since is not None:
        query = query.where(Report.created_at >= since)

    result = await db.execute(query)
    return int(result.scalar_one())


async def update_status(
    db: AsyncSession,
    report: Report,
    *,
    status: ReportStatus,
    updated_by: int,
    updated_by_rank_id: int | None = None,
    rejection_reason: str | None = None,
) -> Report:
    report.status = status
    report.updated_by = updated_by
    report.updated_by_rank_id = updated_by_rank_id
    report.rejection_reason = rejection_reason
    if status == ReportStatus.DELETED:
        report.deleted_at = datetime.now(timezone.utc)
    await db.commit()
    return await get_by_id(db, report.id)


async def get_mirror_of(db: AsyncSession, origin_report_id: uuid.UUID) -> Report | None:
    """Зеркальная копия (см. Report.mirror_of_report_id) этого рапорта в другой
    категории, если она есть — для синхронизации статуса при одобрении/отклонении.
    Только для 1:1 зеркал (см. ReportCategory.mirrors_to_category_id) — у
    совместных категорий (is_joint) зеркал может быть НЕСКОЛЬКО, см. list_mirrors_of."""
    result = await db.execute(select(Report).where(Report.mirror_of_report_id == origin_report_id))
    return result.scalars().first()


async def list_mirrors_of(db: AsyncSession, origin_report_id: uuid.UUID) -> list[Report]:
    """Все зеркальные копии этого рапорта (см. Report.mirror_of_report_id) — для
    совместных категорий (is_joint) их может быть несколько, по одной на каждое
    одобрившее формирование (см. app/api/reports.py::delete_report)."""
    result = await db.execute(select(Report).where(Report.mirror_of_report_id == origin_report_id))
    return list(result.scalars().all())


async def sync_mirror_status(
    db: AsyncSession,
    mirror: Report,
    *,
    status: ReportStatus,
    updated_by: int,
    updated_by_rank_id: int | None = None,
    rejection_reason: str | None = None,
) -> Report:
    """Проставляет статус зеркалу вслед за исходным рапортом — без начисления баллов
    и прочих сайд-эффектов одобрения (те уже применились к исходному рапорту)."""
    mirror.status = status
    mirror.updated_by = updated_by
    mirror.updated_by_rank_id = updated_by_rank_id
    mirror.rejection_reason = rejection_reason
    if status == ReportStatus.DELETED:
        mirror.deleted_at = datetime.now(timezone.utc)
    await db.commit()
    return await get_by_id(db, mirror.id)


async def update_content(db: AsyncSession, report: Report, *, content: str) -> Report:
    report.content = content
    await db.commit()
    return await get_by_id(db, report.id)


async def soft_delete(db: AsyncSession, report: Report, *, updated_by: int) -> Report:
    return await update_status(db, report, status=ReportStatus.DELETED, updated_by=updated_by)


async def set_points(db: AsyncSession, report: Report, *, points: int) -> Report:
    report.points = points
    await db.commit()
    return await get_by_id(db, report.id)


async def get_by_violation_id(db: AsyncSession, violation_id: int) -> Report | None:
    result = await db.execute(select(Report).where(Report.violation_id == violation_id))
    return result.scalars().first()


async def set_violation_id(db: AsyncSession, report: Report, *, violation_id: int) -> Report:
    report.violation_id = violation_id
    await db.commit()
    return await get_by_id(db, report.id)
