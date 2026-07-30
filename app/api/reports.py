"""Эндпоинты для работы с рапортами."""
import logging
import uuid

from fastapi import APIRouter, Depends, File, Query, Response, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AccessContext, get_access_context
from app.core import discord_client
from app.core.events import event_bus
from app.crud import audit_log as audit_log_crud
from app.crud import character as character_crud
from app.crud import notification as notification_crud
from app.crud import promotion as promotion_crud
from app.crud import rank as rank_crud
from app.crud import regiment as regiment_crud
from app.crud import report as report_crud
from app.crud import report_category as report_category_crud
from app.crud import report_image as report_image_crud
from app.crud import report_participant as report_participant_crud
from app.crud import specialization as specialization_crud
from app.crud import user as user_crud
from app.crud import violation as violation_crud
from app.database import get_db
from app.exceptions import AppError, ForbiddenError, NotFoundError
from app.models.report import ReportStatus
from app.schemas.report import ReportContentUpdate, ReportCreate, ReportPointsUpdate, ReportRead, ReportStatusUpdate
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


async def _check_category_filing_restrictions(db: AsyncSession, access: AccessContext, category) -> None:
    if access.is_admin or access.is_high_command:
        return

    if category.commander_only and not access.is_commander_of(category.regiment_id):
        raise ForbiddenError(f"Подавать рапорт категории «{category.name}» может только заместитель+/командир формирования")

    if category.min_rank_id is not None:
        if access.user.rank_id is None:
            raise ForbiddenError(f"Для рапорта категории «{category.name}» требуется как минимум звание {category.min_rank.code}")
        ordered_ranks = await rank_crud.get_all_ranks_ordered(db)
        order_index = {r.id: i for i, r in enumerate(ordered_ranks)}
        if (
            access.user.rank_id in order_index
            and category.min_rank_id in order_index
            and order_index[access.user.rank_id] < order_index[category.min_rank_id]
        ):
            raise ForbiddenError(f"Для рапорта категории «{category.name}» требуется как минимум звание {category.min_rank.code}")


async def _to_report_read(db: AsyncSession, report) -> ReportRead:
    read = ReportRead.model_validate(report)
    # signature comes from character if author has one in this regiment
    character = await character_crud.get_by_user_and_regiment(
        db, user_id=report.user_id, regiment_id=report.regiment_id
    )
    if character is not None:
        read.author.service_id = character.service_id
        read.author.callsign = character.callsign
        if character.rank is not None:
            from app.schemas.rank import RankRead

            read.author_rank = RankRead.model_validate(character.rank)
    return read


async def _to_report_reads(db: AsyncSession, reports: list) -> list[ReportRead]:
    # cache per (user_id, regiment_id), reports outnumber unique pairs
    cache: dict[tuple[int, int], ReportRead | None] = {}
    reads = []
    for report in reports:
        key = (report.user_id, report.regiment_id)
        if key not in cache:
            character = await character_crud.get_by_user_and_regiment(
                db, user_id=report.user_id, regiment_id=report.regiment_id
            )
            cache[key] = character
        read = ReportRead.model_validate(report)
        character = cache[key]
        if character is not None:
            read.author.service_id = character.service_id
            read.author.callsign = character.callsign
            if character.rank is not None:
                from app.schemas.rank import RankRead

                read.author_rank = RankRead.model_validate(character.rank)
        reads.append(read)
    return reads


@router.get("", response_model=list[ReportRead])
async def list_reports(
    response: Response,
    status_filter: ReportStatus | None = Query(default=None, alias="status"),
    regiment_id: int | None = Query(default=None),
    category_id: int | None = Query(default=None),
    search: str | None = Query(default=None, min_length=1, max_length=200),
    limit: int | None = Query(default=None, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[ReportRead]:
    """Список рапортов, доступных пользователю: боец видит только свои, командир — все
    рапорты своего формирования, администратор — все рапорты всех формирований."""
    if not access.has_access:
        raise ForbiddenError("У вас нет доступа ни к одному формированию")

    if not (access.is_admin or access.is_high_command) and access.user.registration_status != "approved":
        raise ForbiddenError("Регистрация ещё не пройдена или не одобрена — рапорты недоступны")

    visible_target_regiment_ids: set[int] | None = None
    if access.is_admin or access.is_high_command:
        # Администратору/высшему командованию доступны все формирования — фильтр не
        # ограничиваем, если явно не запрошено конкретное формирование
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
        # Рапорт о задержании бойца своего формирования виден всем в этом формировании,
        # даже если его подал кто-то из другого (например, военная полиция)
        visible_target_regiment_ids = set(visible_regiment_ids)

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
        search=search,
        visible_target_regiment_ids=visible_target_regiment_ids,
        limit=limit,
        offset=offset,
    )
    if limit is not None:
        total = await report_crud.count_reports(
            db,
            regiment_ids=visible_regiment_ids,
            user_id=user_id_filter,
            category_id=category_id,
            status=status_filter,
            search=search,
            visible_target_regiment_ids=visible_target_regiment_ids,
        )
        response.headers["X-Total-Count"] = str(total)
    return await _to_report_reads(db, reports)


@router.post("", response_model=ReportRead, status_code=201)
async def create_report(
    payload: ReportCreate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> ReportRead:
    """Создание рапорта. Доступно бойцам и командирам своего формирования."""
    if access.user.is_inactive:
        raise ForbiddenError("Вы отмечены как неактивный боец и не можете создавать рапорты")

    if not (access.is_admin or access.is_high_command) and access.user.registration_status != "approved":
        raise ForbiddenError("Регистрация ещё не пройдена или не одобрена — рапорты недоступны")

    allowed_regiments = access.commander_regiment_ids | access.soldier_regiment_ids
    if not (access.is_admin or access.is_high_command) and payload.regiment_id not in allowed_regiments:
        raise ForbiddenError("Вы не состоите в этом формировании")

    target_fields: dict = {}
    category = None
    if payload.category_id is not None:
        category = await report_category_crud.get_by_id(db, payload.category_id)
        if category is not None and category.is_promotion:
            raise ForbiddenError("Категория «Повышение» системная — рапорт в ней создаётся автоматически")
        if category is not None and category.is_demotion:
            raise ForbiddenError("Категория «Понижение» системная — рапорт в ней создаётся автоматически")
        if category is not None and category.is_detention:
            if not access.can_file_detention_report:
                raise ForbiddenError("Подавать рапорт о задержании может только назначенный администратором круг лиц")
            target_fields = await _resolve_detention_target(db, payload)
            target_fields.update(_resolve_punishment(payload))
        if category is not None and category.is_training:
            if not access.can_grant_specializations:
                raise ForbiddenError("Подавать рапорт об обучении может только инструктор или администратор")
            target_fields = await _resolve_training_target(db, payload)
        if category is not None:
            await _check_category_filing_restrictions(db, access, category)

    # training reports auto-approve, no commander review needed
    auto_approve = category is not None and category.is_training and payload.submit
    if auto_approve:
        # check grant eligibility before creating the report, not after -
        # a limit violation must block creation, not fail silently later
        trainee = await user_crud.get_by_discord_id(db, target_fields["target_discord_id"])
        specialization = await specialization_crud.get_by_id(db, target_fields["training_specialization_id"])
        if trainee is not None and specialization is not None:
            from app.api.specializations import _check_can_grant

            await _check_can_grant(db, trainee, specialization)
        status = ReportStatus.APPROVED
    else:
        status = ReportStatus.SUBMITTED if payload.submit else ReportStatus.DRAFT
    points = category.points if (auto_approve and category.points is not None) else None
    report = await report_crud.create_report(
        db,
        user_id=access.user.id,
        regiment_id=payload.regiment_id,
        category_id=payload.category_id,
        content=payload.content,
        status=status,
        author_rank_id=access.user.rank_id,
        participant_discord_ids=payload.participant_discord_ids,
        points=points,
        **target_fields,
    )
    logger.info("Пользователь %s создал рапорт %s (%s)", access.user.username, report.id, status)
    if auto_approve:
        report = await _apply_approval_side_effects(db, report, category, access.user.id)
    event_bus.publish("reports")
    return await _to_report_read(db, report)


async def _resolve_detention_target(db: AsyncSession, payload: ReportCreate) -> dict:
    """Формирование задержанного указывается явно всегда. Сам нарушитель либо
    выбирается из состава Discord-сервера, либо — если его там нет — вводится
    вручную (ИДН + звание + позывной)."""
    if not payload.target_regiment_id:
        raise AppError("Укажите формирование задержанного")
    target_regiment = await regiment_crud.get_by_id(db, payload.target_regiment_id)
    if target_regiment is None:
        raise NotFoundError("Формирование не найдено")

    if payload.target_discord_id:
        members = await discord_client.fetch_guild_members()
        target = next((m for m in members if m["discord_id"] == payload.target_discord_id), None)
        if target is None:
            raise NotFoundError("Участник не найден на сервере")
        return {
            "target_discord_id": target["discord_id"],
            "target_username": target["username"],
            "target_regiment_id": target_regiment.id,
        }

    if not (payload.target_service_id and payload.target_rank_id and payload.target_callsign):
        raise AppError("Нарушителя нет в Discord — укажите вручную ИДН, звание и позывной")

    target_rank = await rank_crud.get_by_id(db, payload.target_rank_id)
    if target_rank is None:
        raise NotFoundError("Звание не найдено")

    return {
        "target_regiment_id": target_regiment.id,
        "target_service_id": payload.target_service_id,
        "target_rank_id": target_rank.id,
        "target_callsign": payload.target_callsign,
    }


async def _resolve_training_target(db: AsyncSession, payload: ReportCreate) -> dict:
    # needs a real discord member (spec is granted to their account) plus catalog spec
    if not payload.target_discord_id:
        raise AppError("Укажите, кому провели обучение")
    if not payload.training_specialization_id:
        raise AppError("Укажите специализацию")

    specialization = await specialization_crud.get_by_id(db, payload.training_specialization_id)
    if specialization is None:
        raise NotFoundError("Специализация не найдена")

    members = await discord_client.fetch_guild_members()
    target = next((m for m in members if m["discord_id"] == payload.target_discord_id), None)
    if target is None:
        raise NotFoundError("Участник не найден на сервере")

    return {
        "target_discord_id": target["discord_id"],
        "target_username": target["username"],
        "training_specialization_id": specialization.id,
    }


def _resolve_punishment(payload: ReportCreate) -> dict:
    if not payload.punishment_type:
        raise AppError("Укажите вид наказания")
    if payload.punishment_type == "other" and not (payload.punishment_other_text or "").strip():
        raise AppError("Укажите, за что именно наказание, если выбрано «Другое»")
    return {
        "punishment_type": payload.punishment_type,
        "punishment_other_text": payload.punishment_other_text,
        "punishment_amount": payload.punishment_amount,
    }


async def _apply_approval_side_effects(db: AsyncSession, updated, category, actor_user_id: int):
    # shared by manual approval (update_report_status) and training auto-approve (create_report)
    if category is not None and category.is_detention and updated.violation_id is None:
        violation = await violation_crud.create(
            db,
            target_discord_id=updated.target_discord_id,
            target_username=updated.target_username,
            target_regiment_id=updated.target_regiment_id,
            target_service_id=updated.target_service_id,
            target_rank_id=updated.target_rank_id,
            target_callsign=updated.target_callsign,
            punishment_type=updated.punishment_type,
            punishment_other_text=updated.punishment_other_text,
            punishment_amount=updated.punishment_amount,
            description=updated.content,
            created_by=updated.user_id,
        )
        updated = await report_crud.set_violation_id(db, updated, violation_id=violation.id)

        if updated.target_regiment_id is not None:
            target_label = updated.target_username or f"{updated.target_service_id} {updated.target_callsign}"
            await notification_crud.create_violation_notification(
                db,
                regiment_id=updated.target_regiment_id,
                violation_id=violation.id,
                title=f"Новое нарушение: {target_label}",
                body=updated.content,
                created_by=updated.user_id,
            )
        logger.info("Рапорт о задержании %s превращён в нарушение %s", updated.id, violation.id)

    # best-effort: a limit violation shouldn't block an already-approved report, just skip the grant
    if (
        category is not None
        and category.is_training
        and updated.training_specialization_id is not None
        and updated.target_discord_id is not None
    ):
        trainee = await user_crud.get_by_discord_id(db, updated.target_discord_id)
        if trainee is not None:
            try:
                from app.api.specializations import _check_can_grant

                specialization = await specialization_crud.get_by_id(db, updated.training_specialization_id)
                if specialization is not None:
                    await _check_can_grant(db, trainee, specialization)
                await specialization_crud.grant(
                    db,
                    user_id=trainee.id,
                    specialization_id=updated.training_specialization_id,
                    granted_by_user_id=actor_user_id,
                )
                await notification_crud.create_personal_notification(
                    db,
                    target_user_id=trainee.id,
                    title="Выдана специализация",
                    body="Вам выдана специализация по итогам рапорта об обучении.",
                    created_by=actor_user_id,
                )
                logger.info(
                    "Рапорт об обучении %s одобрен — специализация %s выдана %s",
                    updated.id,
                    updated.training_specialization_id,
                    updated.target_discord_id,
                )
            except AppError as e:
                logger.warning("Рапорт об обучении %s одобрен, но специализация не выдана: %s", updated.id, e)

    if category is not None and category.participant_points:
        if updated.participant_discord_ids:
            participants = await user_crud.get_by_discord_ids(db, updated.participant_discord_ids)
            for participant in participants:
                if participant.id == updated.user_id:
                    continue
                await report_participant_crud.award(
                    db, report_id=updated.id, user_id=participant.id, points=category.participant_points
                )
                await promotion_crud.check_and_create_promotion_request(db, participant, regiment_id=updated.regiment_id)

    await promotion_crud.check_and_create_promotion_request(db, updated.author, regiment_id=updated.regiment_id)
    return updated


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

    if not access.can_appeal_report(report.regiment_id) and not is_self_submit:
        raise ForbiddenError("Изменять статус рапорта может только командир формирования")

    category = None
    if report.category_id is not None:
        category = await report_category_crud.get_by_id(db, report.category_id)

    if category is not None and category.is_promotion:
        raise ForbiddenError(
            "Это дубликат заявки на повышение — решение принимается на странице «Повышения», "
            "а не здесь, чтобы не разойтись с фактическим статусом заявки"
        )
    if category is not None and category.is_demotion:
        raise ForbiddenError("Это системная запись о понижении — статус уже окончателен, его нельзя менять")

    # only someone who can grant specializations can reject a training report
    if (
        category is not None
        and category.is_training
        and payload.status == ReportStatus.REJECTED
        and not (access.is_admin or access.is_high_command or access.can_grant_specializations)
    ):
        raise ForbiddenError("Отклонить рапорт об обучении может только инструктор или администратор")

    was_approved = report.status == ReportStatus.APPROVED

    # Автоначисление балла категории при одобрении — только если рапорту ещё не
    # выставлен балл вручную, и у его категории задан балл по умолчанию
    if payload.status == ReportStatus.APPROVED and report.points is None and category is not None:
        if category.points is not None:
            report.points = category.points

    updated = await report_crud.update_status(
        db,
        report,
        status=payload.status,
        updated_by=access.user.id,
        updated_by_rank_id=access.user.rank_id,
        rejection_reason=payload.rejection_reason,
    )
    logger.info(
        "Командир %s изменил статус рапорта %s на %s", access.user.username, report_id, payload.status
    )

    if payload.status == ReportStatus.APPROVED:
        updated = await _apply_approval_side_effects(db, updated, category, access.user.id)
    elif payload.status == ReportStatus.REJECTED and was_approved:
        # appeal on already-approved report: undo participant points so they
        # don't stay double-counted (author's points clear themselves via
        # sum_approved_points, no extra code needed there)
        await report_participant_crud.delete_for_report(db, report_id=updated.id)

    event_bus.publish("reports")
    return await _to_report_read(db, updated)


@router.patch("/{report_id}/content", response_model=ReportRead)
async def update_report_content(
    report_id: uuid.UUID,
    payload: ReportContentUpdate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> ReportRead:
    # draft only, once submitted content is locked (delete + refile instead)
    report = await report_crud.get_by_id(db, report_id)
    if report is None:
        raise NotFoundError("Рапорт не найден")
    if report.user_id != access.user.id or report.status != ReportStatus.DRAFT:
        raise ForbiddenError("Редактировать можно только свой черновик")

    updated = await report_crud.update_content(db, report, content=payload.content)
    logger.info("%s отредактировал черновик рапорта %s", access.user.username, report_id)
    event_bus.publish("reports")
    return await _to_report_read(db, updated)


@router.delete("/{report_id}", response_model=ReportRead)
async def delete_report(
    report_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> ReportRead:
    # own unsent draft can be deleted without extra rights
    report = await report_crud.get_by_id(db, report_id)
    if report is None:
        raise NotFoundError("Рапорт не найден")

    is_own_draft = report.user_id == access.user.id and report.status == ReportStatus.DRAFT

    category = None
    if report.category_id is not None:
        category = await report_category_crud.get_by_id(db, report.category_id)

    if is_own_draft:
        pass
    elif category is not None and category.is_detention:
        if not access.is_admin:
            raise ForbiddenError("Аннулировать рапорт о задержании может только администратор")
        await audit_log_crud.log(
            db,
            actor_user_id=access.user.id,
            actor_is_admin=access.is_admin,
            action="detention_report_delete",
            details=f"Удалил рапорт о задержании {report_id} (формирование {report.regiment_id})",
        )
        if report.violation_id is not None:
            violation = await violation_crud.get_by_id(db, report.violation_id)
            if violation is not None:
                await violation_crud.delete(db, violation)
    elif not access.can_appeal_report(report.regiment_id):
        raise ForbiddenError("Удалять рапорт может только командир формирования")

    deleted = await report_crud.soft_delete(db, report, updated_by=access.user.id)
    logger.info("%s удалил рапорт %s", access.user.username, report_id)
    event_bus.publish("reports")
    return await _to_report_read(db, deleted)


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

    # points may change after approval, recheck promotion eligibility
    if updated.status == ReportStatus.APPROVED:
        await promotion_crud.check_and_create_promotion_request(db, updated.author, regiment_id=updated.regiment_id)
    event_bus.publish("promotions")
    return await _to_report_read(db, updated)


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
