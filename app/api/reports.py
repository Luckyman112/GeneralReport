"""Эндпоинты для работы с рапортами."""
import logging
import uuid

from fastapi import APIRouter, Depends, File, Query, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AccessContext, get_access_context
from app.crud import report as report_crud
from app.crud import report_category as report_category_crud
from app.crud import report_image as report_image_crud
from app.database import get_db
from app.exceptions import AppError, ForbiddenError, NotFoundError
from app.models.report import ReportStatus
from app.schemas.report import ReportCreate, ReportPointsUpdate, ReportRead, ReportStatusUpdate
from app.schemas.report_image import ReportImageRead

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/reports", tags=["reports"])

ALLOWED_IMAGE_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}
MAX_IMAGE_SIZE = 5 * 1024 * 1024  # 5 МБ


@router.get("", response_model=list[ReportRead])
async def list_reports(
    status_filter: ReportStatus | None = Query(default=None, alias="status"),
    regiment_id: int | None = Query(default=None),
    category_id: int | None = Query(default=None),
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
        db,
        regiment_ids=visible_regiment_ids,
        user_id=user_id_filter,
        category_id=category_id,
        status=status_filter,
    )
    return [ReportRead.model_validate(r) for r in reports]


@router.post("", response_model=ReportRead, status_code=201)
async def create_report(
    payload: ReportCreate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> ReportRead:
    """Создание рапорта. Доступно бойцам и командирам своего формирования."""
    if access.user.is_inactive:
        raise ForbiddenError("Вы отмечены как неактивный боец и не можете создавать рапорты")

    allowed_regiments = access.commander_regiment_ids | access.soldier_regiment_ids
    if not access.is_admin and payload.regiment_id not in allowed_regiments:
        raise ForbiddenError("Вы не состоите в этом формировании")

    status = ReportStatus.SUBMITTED if payload.submit else ReportStatus.DRAFT
    report = await report_crud.create_report(
        db,
        user_id=access.user.id,
        regiment_id=payload.regiment_id,
        category_id=payload.category_id,
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

    # Автоначисление балла категории при одобрении — только если рапорту ещё не
    # выставлен балл вручную, и у его категории задан балл по умолчанию
    if payload.status == ReportStatus.APPROVED and report.points is None and report.category_id is not None:
        category = await report_category_crud.get_by_id(db, report.category_id)
        if category is not None and category.points is not None:
            report.points = category.points

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


@router.patch("/{report_id}/points", response_model=ReportRead)
async def update_report_points(
    report_id: uuid.UUID,
    payload: ReportPointsUpdate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> ReportRead:
    """Выставить балл за рапорт — только полноправный командир (не заместитель)
    или администратор."""
    report = await report_crud.get_by_id(db, report_id)
    if report is None:
        raise NotFoundError("Рапорт не найден")

    if not access.is_full_commander_of(report.regiment_id):
        raise ForbiddenError("Выставлять баллы может только командир формирования")

    updated = await report_crud.set_points(db, report, points=payload.points)
    logger.info("%s выставил %s баллов рапорту %s", access.user.username, payload.points, report_id)
    return ReportRead.model_validate(updated)


@router.post("/{report_id}/images", response_model=ReportImageRead, status_code=201)
async def upload_report_image(
    report_id: uuid.UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> ReportImageRead:
    """Прикрепить картинку к рапорту — доступно автору рапорта или командиру/
    заместителю формирования."""
    report = await report_crud.get_by_id(db, report_id)
    if report is None:
        raise NotFoundError("Рапорт не найден")

    is_author = report.user_id == access.user.id
    if not is_author and not access.is_commander_of(report.regiment_id):
        raise ForbiddenError("Прикреплять картинки может автор рапорта или командир формирования")

    ext = ALLOWED_IMAGE_TYPES.get(file.content_type)
    if ext is None:
        raise AppError("Разрешены только изображения: JPEG, PNG, WEBP, GIF")

    content = await file.read()
    if len(content) > MAX_IMAGE_SIZE:
        raise AppError("Файл слишком большой (максимум 5 МБ)")

    report_dir = report_image_crud.UPLOAD_ROOT / str(report_id)
    report_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4()}{ext}"
    (report_dir / filename).write_bytes(content)

    image = await report_image_crud.create(
        db, report_id=report_id, filename=filename, url=f"/uploads/reports/{report_id}/{filename}"
    )
    logger.info("%s прикрепил картинку к рапорту %s", access.user.username, report_id)
    return ReportImageRead.model_validate(image)


@router.delete("/{report_id}/images/{image_id}", status_code=204)
async def delete_report_image(
    report_id: uuid.UUID,
    image_id: int,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> None:
    """Удалить картинку рапорта — доступно только командиру/заместителю формирования
    (в отличие от загрузки — автор рапорта удалять картинки не может)."""
    report = await report_crud.get_by_id(db, report_id)
    if report is None:
        raise NotFoundError("Рапорт не найден")

    if not access.is_commander_of(report.regiment_id):
        raise ForbiddenError("Удалять картинки может только командир формирования")

    image = await report_image_crud.get_by_id(db, image_id)
    if image is None or image.report_id != report_id:
        raise NotFoundError("Картинка не найдена")

    await report_image_crud.delete(db, image)
