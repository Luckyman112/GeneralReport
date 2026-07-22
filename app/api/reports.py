"""Эндпоинты для работы с рапортами."""
import logging
import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AccessContext, get_access_context
from app.crud import report as report_crud
from app.database import get_db
from app.exceptions import ForbiddenError, NotFoundError
from app.models.report import ReportStatus
from app.schemas.report import ReportCreate, ReportRead, ReportStatusUpdate

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("", response_model=list[ReportRead])
async def list_reports(
    status_filter: ReportStatus | None = Query(default=None, alias="status"),
    regiment_id: int | None = Query(default=None),
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[ReportRead]:
    """Список рапортов, доступных пользователю: боец видит только свои, командир — все
    рапорты своего формирования, администратор — все рапорты всех формирований."""
    if not access.has_access:
        raise ForbiddenError("У вас нет доступа ни к одному формированию")

    if access.is_admin:
        # Администратору доступны все формирования — фильтр не ограничиваем,
        # если явно не запрошено конкретное формирование
        visible_regiment_ids = [regiment_id] if regiment_id is not None else None
        user_id_filter = None
    else:
        visible_ids = access.commander_regiment_ids | access.soldier_regiment_ids
        if regiment_id is not None:
            if regiment_id not in visible_ids:
                raise ForbiddenError("Нет доступа к этому формированию")
            visible_regiment_ids = [regiment_id]
        else:
            visible_regiment_ids = list(visible_ids)

        # Боец без командирских прав в данном формировании видит только свои рапорты.
        # Если пользователь командир хотя бы одного из запрошенных формирований —
        # ограничение по автору не накладывается для этих формирований.
        if access.commander_regiment_ids >= set(visible_regiment_ids):
            user_id_filter = None
        elif not access.commander_regiment_ids:
            user_id_filter = access.user.id
        else:
            # Смешанный случай (командир одних, боец других формирований) —
            # для простоты и безопасности сужаем до собственных рапортов.
            user_id_filter = access.user.id

    reports = await report_crud.list_reports(
        db, regiment_ids=visible_regiment_ids, user_id=user_id_filter, status=status_filter
    )
    return [ReportRead.model_validate(r) for r in reports]


@router.post("", response_model=ReportRead, status_code=201)
async def create_report(
    payload: ReportCreate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> ReportRead:
    """Создание рапорта. Доступно бойцам и командирам своего формирования."""
    allowed_regiments = access.commander_regiment_ids | access.soldier_regiment_ids
    if not access.is_admin and payload.regiment_id not in allowed_regiments:
        raise ForbiddenError("Вы не состоите в этом формировании")

    status = ReportStatus.SUBMITTED if payload.submit else ReportStatus.DRAFT
    report = await report_crud.create_report(
        db,
        user_id=access.user.id,
        regiment_id=payload.regiment_id,
        content=payload.content,
        status=status,
    )
    logger.info("Пользователь %s создал рапорт %s (%s)", access.user.username, report.id, status)
    return ReportRead.model_validate(report)


@router.patch("/{report_id}", response_model=ReportRead)
async def update_report_status(
    report_id: uuid.UUID,
    payload: ReportStatusUpdate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> ReportRead:
    """Изменение статуса рапорта. Одобрить/отклонить/удалить может только командир
    формирования или администратор. Отдельное исключение: автор рапорта может сам
    отправить свой черновик (draft -> submitted) — это не смена решения по рапорту,
    а его собственное действие "отправить"."""
    report = await report_crud.get_by_id(db, report_id)
    if report is None:
        raise NotFoundError("Рапорт не найден")

    is_self_submit = (
        report.user_id == access.user.id
        and report.status == ReportStatus.DRAFT
        and payload.status == ReportStatus.SUBMITTED
        and payload.rejection_reason is None
    )

    if not access.is_commander_of(report.regiment_id) and not is_self_submit:
        raise ForbiddenError("Изменять статус рапорта может только командир формирования")

    updated = await report_crud.update_status(
        db,
        report,
        status=payload.status,
        updated_by=access.user.id,
        rejection_reason=payload.rejection_reason,
    )
    logger.info(
        "Командир %s изменил статус рапорта %s на %s", access.user.username, report_id, payload.status
    )
    return ReportRead.model_validate(updated)


@router.delete("/{report_id}", response_model=ReportRead)
async def delete_report(
    report_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> ReportRead:
    """Мягкое удаление рапорта — только командир формирования или администратор."""
    report = await report_crud.get_by_id(db, report_id)
    if report is None:
        raise NotFoundError("Рапорт не найден")

    if not access.is_commander_of(report.regiment_id):
        raise ForbiddenError("Удалять рапорт может только командир формирования")

    deleted = await report_crud.soft_delete(db, report, updated_by=access.user.id)
    logger.info("Командир %s удалил рапорт %s", access.user.username, report_id)
    return ReportRead.model_validate(deleted)
