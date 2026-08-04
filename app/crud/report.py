import uuid
from datetime import datetime, timezone

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.report import Report, ReportStatus
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
    )
    db.add(report)
    await db.commit()
    return await get_by_id(db, report.id)


async def list_since(db: AsyncSession, *, user_id: int, since, status: ReportStatus | None = None) -> list[Report]:
    """Рапорты пользователя начиная с указанной даты (используется для обзора
    повышения — рапорты за текущее звание, с даты назначения этого звания)."""
    query = select(Report).where(Report.user_id == user_id, Report.created_at >= since).options(*_LOAD_OPTIONS)
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
    visible_target_regiment_ids: set[int] | None = None,
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

    include_deleted — показать и мягко удалённые (аннулированные) рапорты тоже
    (см. app/api/regiments.py::get_member_reports — в личном деле аннулирование
    должно быть видно, а не бесследно исчезать)."""
    query = select(Report).options(*_LOAD_OPTIONS).order_by(Report.created_at.desc())

    base_conditions = []
    if regiment_ids is not None:
        base_conditions.append(Report.regiment_id.in_(regiment_ids))
    if user_id is not None:
        base_conditions.append(Report.user_id == user_id)

    if visible_target_regiment_ids:
        target_clause = and_(
            Report.target_regiment_id.in_(visible_target_regiment_ids),
            Report.status != ReportStatus.DRAFT,
        )
        query = query.where(or_(and_(*base_conditions), target_clause) if base_conditions else target_clause)
    elif base_conditions:
        query = query.where(and_(*base_conditions))

    if category_id is not None:
        query = query.where(Report.category_id == category_id)
    if status is not None:
        query = query.where(Report.status == status)
    elif not include_deleted:
        # По умолчанию не показываем удалённые рапорты, если статус не запрошен явно
        query = query.where(Report.status != ReportStatus.DELETED)

    if search:
        query = query.where(Report.content.ilike(f"%{search}%"))

    if limit is not None:
        query = query.limit(limit).offset(offset)

    result = await db.execute(query)
    return list(result.scalars().all())


async def count_reports(
    db: AsyncSession,
    *,
    regiment_ids: list[int] | None = None,
    user_id: int | None = None,
    category_id: int | None = None,
    status: ReportStatus | None = None,
    search: str | None = None,
    visible_target_regiment_ids: set[int] | None = None,
) -> int:
    """Тот же набор фильтров, что и list_reports — для отображения "Показать ещё"
    на фронте (сколько всего рапортов помимо уже загруженных)."""
    query = select(func.count()).select_from(Report)

    base_conditions = []
    if regiment_ids is not None:
        base_conditions.append(Report.regiment_id.in_(regiment_ids))
    if user_id is not None:
        base_conditions.append(Report.user_id == user_id)

    if visible_target_regiment_ids:
        target_clause = and_(
            Report.target_regiment_id.in_(visible_target_regiment_ids),
            Report.status != ReportStatus.DRAFT,
        )
        query = query.where(or_(and_(*base_conditions), target_clause) if base_conditions else target_clause)
    elif base_conditions:
        query = query.where(and_(*base_conditions))

    if category_id is not None:
        query = query.where(Report.category_id == category_id)
    if status is not None:
        query = query.where(Report.status == status)
    else:
        query = query.where(Report.status != ReportStatus.DELETED)

    if search:
        query = query.where(Report.content.ilike(f"%{search}%"))

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
