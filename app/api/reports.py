"""Эндпоинты для работы с рапортами."""
import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Query, Response, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AccessContext, get_access_context
from app.core import discord_client
from app.core.events import event_bus
from app.core.uploads import read_image_upload
from app.crud import audit_log as audit_log_crud
from app.crud import character as character_crud
from app.crud import jedi_trial as jedi_trial_crud
from app.crud import notification as notification_crud
from app.crud import promotion as promotion_crud
from app.crud import rank as rank_crud
from app.crud import regiment as regiment_crud
from app.crud import report as report_crud
from app.crud import report_category as report_category_crud
from app.crud import report_image as report_image_crud
from app.crud import report_participant as report_participant_crud
from app.crud import report_regiment_decision as report_regiment_decision_crud
from app.crud import specialization as specialization_crud
from app.crud import squad as squad_crud
from app.crud import stats as stats_crud
from app.crud import user as user_crud
from app.crud import violation as violation_crud
from app.database import get_db
from app.exceptions import AppError, ForbiddenError, NotFoundError
from app.models.report import ReportStatus
from app.models.report_regiment_decision import RegimentDecisionStatus
from app.schemas.report import (
    RegimentDecisionUpdate,
    ReportContentUpdate,
    ReportCreate,
    ReportPointsUpdate,
    ReportRead,
    ReportRegimentDecisionRead,
    ReportStatusUpdate,
)
from app.schemas.report_image import ReportImageRead
from app.schemas.user import UserBrief

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
    if category.is_training and access.can_grant_specializations:
        return

    is_foreign_leadership = category.open_to_regiment_leadership and bool(access.commander_regiment_ids)
    if category.commander_only and not (access.is_commander_of(category.regiment_id) or is_foreign_leadership):
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

    if category.required_specialization_id is not None:
        has_it = await specialization_crud.has_specialization(
            db, user_id=access.user.id, specialization_id=category.required_specialization_id
        )
        if not has_it:
            spec_label = category.required_specialization.name if category.required_specialization else "нужная специализация"
            raise ForbiddenError(f"Подавать рапорт категории «{category.name}» может только боец со специализацией «{spec_label}»")

    if category.required_squad_id is not None:
        membership = await squad_crud.get_membership(
            db, squad_id=category.required_squad_id, discord_id=access.user.discord_id
        )
        if membership is None:
            squad_label = category.required_squad.name if category.required_squad else "нужный отряд"
            raise ForbiddenError(f"Подавать рапорт категории «{category.name}» может только участник отряда «{squad_label}»")

    if category.max_per_day is not None:
        today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        count_today = await report_crud.count_reports(
            db, user_id=access.user.id, category_id=category.id, since=today_start
        )
        if count_today >= category.max_per_day:
            raise ForbiddenError(
                f"Рапорт категории «{category.name}» можно подавать не чаще {category.max_per_day} раз(а) в день"
            )


async def _create_mirror_report(db: AsyncSession, report, category) -> None:
    """См. ReportCategory.mirrors_to_category_id — read-only копия рапорта в
    другой категории (обычно Штаба), для общего обзора без влияния на баллы
    (баллы уже начислены/будут начислены по исходному рапорту)."""
    mirror_category = await report_category_crud.get_by_id(db, category.mirrors_to_category_id)
    if mirror_category is None:
        return
    await report_crud.create_report(
        db,
        user_id=report.user_id,
        regiment_id=mirror_category.regiment_id,
        category_id=mirror_category.id,
        content=report.content,
        status=report.status,
        author_rank_id=report.author_rank_id,
        mirror_of_report_id=report.id,
    )


async def _create_joint_decisions(db: AsyncSession, report, category) -> None:
    """См. ReportCategory.is_joint — заводит по одной pending-записи на каждое
    формирование, реально обнаруженное среди участников (поля "Состав" и т.п.),
    чтобы их командиры могли одобрить/отклонить свою часть независимо."""
    regiments_by_discord_id = await regiment_crud.resolve_regiments_for_discord_ids(
        db, report.participant_discord_ids
    )
    participating_regiment_ids = sorted({rid for ids in regiments_by_discord_id.values() for rid in ids})
    if not participating_regiment_ids:
        return
    await report_regiment_decision_crud.create_pending_for_regiments(
        db, report_id=report.id, regiment_ids=participating_regiment_ids
    )


async def _attach_regiment_decisions(read: ReportRead, decisions: list) -> None:
    read.regiment_decisions = [
        ReportRegimentDecisionRead(
            regiment_id=d.regiment_id,
            regiment_name=d.regiment.name,
            status=d.status,
            decided_by_user=UserBrief.model_validate(d.decided_by_user) if d.decided_by_user else None,
            decided_at=d.decided_at,
            rejection_reason=d.rejection_reason,
        )
        for d in decisions
    ]


def _attach_training_specializations(read: ReportRead, report, specs_by_id: dict) -> None:
    if report.training_specialization_ids:
        from app.schemas.specialization import SpecializationRead

        read.training_specializations = [
            SpecializationRead.model_validate(specs_by_id[sid])
            for sid in report.training_specialization_ids
            if sid in specs_by_id
        ]


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
    if report.training_specialization_ids:
        specs_by_id = {s.id: s for s in await specialization_crud.get_all(db)}
        _attach_training_specializations(read, report, specs_by_id)
    decisions = await report_regiment_decision_crud.list_for_report(db, report.id)
    if decisions:
        await _attach_regiment_decisions(read, decisions)
    return read


async def _to_report_reads(db: AsyncSession, reports: list) -> list[ReportRead]:
    # cache per (user_id, regiment_id), reports outnumber unique pairs
    cache: dict[tuple[int, int], ReportRead | None] = {}
    specs_by_id = {s.id: s for s in await specialization_crud.get_all(db)}
    decisions_by_report_id: dict = {}
    for d in await report_regiment_decision_crud.list_for_reports(db, [r.id for r in reports]):
        decisions_by_report_id.setdefault(d.report_id, []).append(d)
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
        _attach_training_specializations(read, report, specs_by_id)
        if report.id in decisions_by_report_id:
            await _attach_regiment_decisions(read, decisions_by_report_id[report.id])
        reads.append(read)
    return reads


@router.get("", response_model=list[ReportRead])
async def list_reports(
    response: Response,
    status_filter: ReportStatus | None = Query(default=None, alias="status"),
    regiment_id: int | None = Query(default=None),
    category_id: int | None = Query(default=None),
    search: str | None = Query(default=None, min_length=1, max_length=200),
    period: str | None = Query(default=None, pattern="^(day|week|month|all)$"),
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

    category_is_training = False
    if category_id is not None:
        category = await report_category_crud.get_by_id(db, category_id)
        category_is_training = category is not None and category.is_training

    visible_target_regiment_ids: set[int] | None = None
    joint_decision_regiment_ids: set[int] | None = None
    if access.is_admin or access.is_high_command or (category_is_training and access.can_grant_specializations):
        # Администратору/высшему командованию доступны все формирования — фильтр не
        # ограничиваем, если явно не запрошено конкретное формирование; инструктор так же
        # видит рапорты об обучении любого формирования (не только своего)
        visible_regiment_ids = [regiment_id] if regiment_id is not None else None
        user_id_filter = None
    else:
        visible_ids = access.commander_regiment_ids | access.soldier_regiment_ids
        # Совместные рапорты (см. ReportCategory.is_joint) числятся за
        # формированием-подателем (обычно Штаб), но командир формирования-участника,
        # не состоящий там, всё равно должен их видеть — у него есть решение по
        # ним (см. app/crud/report.py::list_reports joint_decision_regiment_ids)
        joint_decision_regiment_ids = access.commander_regiment_ids or None
        if regiment_id is not None:
            # Совместные решения проверяются на уровне самого запроса (OR-условие
            # в report_crud.list_reports) — здесь достаточно не отказывать в
            # доступе только из-за того, что regiment_id не входит в свои
            # формирования, если есть хоть какие-то решения формирований-командиров
            if regiment_id not in visible_ids and not joint_decision_regiment_ids:
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

    since = stats_crud.period_cutoff(period) if period else None
    reports = await report_crud.list_reports(
        db,
        regiment_ids=visible_regiment_ids,
        user_id=user_id_filter,
        category_id=category_id,
        status=status_filter,
        search=search,
        since=since,
        visible_target_regiment_ids=visible_target_regiment_ids,
        joint_decision_regiment_ids=joint_decision_regiment_ids,
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
            since=since,
            visible_target_regiment_ids=visible_target_regiment_ids,
            joint_decision_regiment_ids=joint_decision_regiment_ids,
        )
        response.headers["X-Total-Count"] = str(total)
    return await _to_report_reads(db, reports)


@router.get("/recruit-training", response_model=list[ReportRead])
async def list_recruit_training_reports(
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[ReportRead]:
    """Все рапорты «Курс молодого бойца» разом, открыто ЛЮБОМУ зарегистрированному
    бойцу, а не только командирам 17-го Передового Полка/decision-makers (см.
    решение пользователя — «Рекрутская», обычная видимость GET /reports по
    формированиям тут не подходит, т.к. подать может Капрал+ из ЛЮБОГО
    формирования — см. is_recruit_promotion). Черновики не попадают сюда, см.
    report_crud.list_for_category_public."""
    if not access.has_access:
        raise ForbiddenError("У вас нет доступа ни к одному формированию")
    if access.recruit_regiment_id is None:
        return []
    category = await report_category_crud.get_recruit_promotion_category(db, access.recruit_regiment_id)
    if category is None:
        return []
    reports = await report_crud.list_for_category_public(db, category_id=category.id)
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

    category = None
    if payload.category_id is not None:
        category = await report_category_crud.get_by_id(db, payload.category_id)

    # instructor files a training report for any regiment, not only their own
    is_instructor_training = category is not None and category.is_training and access.can_grant_specializations
    # category explicitly open to any regiment's leadership (e.g. Штаб's "Боевая
    # готовность"/"Защита ОВО" — other formations' commanders/deputies report in)
    is_leadership_report = (
        category is not None and category.open_to_regiment_leadership and bool(access.commander_regiment_ids)
    )
    # "Курс молодого бойца" — подать может любой CPL+ (min_rank_id проверит
    # _check_category_filing_restrictions ниже), независимо от формирования —
    # не только командиры/замы, как в is_leadership_report
    is_recruit_report = category is not None and category.is_recruit_promotion

    allowed_regiments = access.commander_regiment_ids | access.soldier_regiment_ids
    if (
        not (
            access.is_admin
            or access.is_high_command
            or is_instructor_training
            or is_leadership_report
            or is_recruit_report
        )
        and payload.regiment_id not in allowed_regiments
    ):
        raise ForbiddenError("Вы не состоите в этом формировании")

    target_fields: dict = {}
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
    if category is not None and category.is_recruit_promotion:
        target_fields = await _resolve_recruit_target(db, payload)
    if category is not None and category.is_jedi_trial_report:
        target_fields = await _resolve_jedi_trial_target(db, payload)
    if category is not None and category.is_jedi_attestation_report:
        target_fields = await _resolve_jedi_attestation_target(db, payload)
    if category is not None:
        await _check_category_filing_restrictions(db, access, category)

    # training reports (specialization / КМБ) auto-approve, no commander review needed
    auto_approve = (
        category is not None and (category.is_training or category.is_recruit_promotion) and payload.submit
    )
    if auto_approve and category.is_training:
        # check grant eligibility for EACH specialization before creating the report,
        # not after — a limit violation must block creation, not fail silently later
        trainee = await user_crud.get_by_discord_id(db, target_fields["target_discord_id"])
        if trainee is not None:
            from app.api.specializations import _check_can_grant

            for specialization_id in target_fields["training_specialization_ids"]:
                specialization = await specialization_crud.get_by_id(db, specialization_id)
                if specialization is not None:
                    await _check_can_grant(db, trainee, specialization)
    if auto_approve:
        status = ReportStatus.APPROVED
    else:
        status = ReportStatus.SUBMITTED if payload.submit else ReportStatus.DRAFT
    # Баллы за обучение считаются позже, в _apply_approval_side_effects, по
    # ФАКТИЧЕСКИ выданным специализациям — не здесь по запрошенным, иначе
    # частичный отказ по лимиту (best-effort цикл там же) переплачивал бы
    # инструктору за специализации, которые реально не засчитались.
    points = None
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
    if status == ReportStatus.SUBMITTED and category is not None and category.mirrors_to_category_id is not None:
        await _create_mirror_report(db, report, category)
    if status == ReportStatus.SUBMITTED and category is not None and category.is_joint:
        await _create_joint_decisions(db, report, category)
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
    # needs a real discord member (spec is granted to their account) plus catalog specs
    if not payload.target_discord_id:
        raise AppError("Укажите, кому провели обучение")
    if not payload.training_specialization_ids:
        raise AppError("Укажите хотя бы одну специализацию")

    specialization_ids = list(dict.fromkeys(payload.training_specialization_ids))  # de-dupe, keep order
    for specialization_id in specialization_ids:
        if await specialization_crud.get_by_id(db, specialization_id) is None:
            raise NotFoundError("Специализация не найдена")

    members = await discord_client.fetch_guild_members()
    target = next((m for m in members if m["discord_id"] == payload.target_discord_id), None)
    if target is None:
        raise NotFoundError("Участник не найден на сервере")

    return {
        "target_discord_id": target["discord_id"],
        "target_username": target["username"],
        "training_specialization_ids": specialization_ids,
    }


async def _resolve_recruit_target(db: AsyncSession, payload: ReportCreate) -> dict:
    """Цель "Курса молодого бойца" — обязательно реальный участник Discord-сервера
    с ролью 17-го Передового Полка (звание в БД может быть RCT уже и по другой
    причине, поэтому проверяем именно роль, а не rank_id)."""
    if not payload.target_discord_id:
        raise AppError("Укажите, кого обучили")

    recruit_regiment = await regiment_crud.get_by_name(db, regiment_crud.RECRUIT_REGIMENT_NAME)
    if recruit_regiment is None:
        raise AppError("17-й Передовой Полк не настроен — обратитесь к администратору")

    members = await discord_client.fetch_guild_members()
    target = next((m for m in members if m["discord_id"] == payload.target_discord_id), None)
    if target is None:
        raise NotFoundError("Участник не найден на сервере")
    if recruit_regiment.discord_role_id not in target["roles"]:
        raise AppError(f"{target['username']} не состоит в 17-м Передовом Полку")

    return {
        "target_discord_id": target["discord_id"],
        "target_username": target["username"],
    }


async def _resolve_jedi_trial_target(db: AsyncSession, payload: ReportCreate) -> dict:
    """Цель рапорта "Наставничество" — падаван, у которого сейчас доступно
    следующее по порядку испытание (сдана проверка разрыва в днях, см.
    jedi_trial_crud.TRIAL_GAP_DAYS) — валидируем при ПОДАЧЕ, чтобы отклонить
    рано, а не когда командир уже одобрил; на одобрении то же самое
    перепроверяется мягко (см. _apply_approval_side_effects)."""
    if not payload.target_discord_id:
        raise AppError("Укажите падавана")

    members = await discord_client.fetch_guild_members()
    target_member = next((m for m in members if m["discord_id"] == payload.target_discord_id), None)
    if target_member is None:
        raise NotFoundError("Участник не найден на сервере")

    target_user = await user_crud.get_by_discord_id_with_rank(db, payload.target_discord_id)
    if target_user is None or target_user.rank is None or target_user.rank.code != "PDW":
        raise AppError(f"{target_member['username']} не в ранге Падавана")

    passed = await jedi_trial_crud.list_for_user(db, user_id=target_user.id)
    trial_number = jedi_trial_crud.next_trial_number(passed)
    # Испытания 1-5 только — 6-е (аттестация) подаётся отдельной категорией
    # is_jedi_attestation_report, см. _resolve_jedi_attestation_target
    if trial_number is None or trial_number > 5:
        raise AppError(
            f"У {target_member['username']} уже сданы все 5 испытаний — для аттестации подайте рапорт «Аттестация»"
        )
    available_at = jedi_trial_crud.earliest_available_at(passed, padawan_since=target_user.rank_assigned_at)
    if available_at is not None and datetime.now(timezone.utc) < available_at:
        raise AppError(
            f"Испытание {trial_number} для {target_member['username']} доступно не раньше "
            f"{available_at.strftime('%d.%m.%Y %H:%M')} МСК"
        )

    return {
        "target_discord_id": target_member["discord_id"],
        "target_username": target_member["username"],
    }


async def _resolve_jedi_attestation_target(db: AsyncSession, payload: ReportCreate) -> dict:
    """Цель рапорта "Аттестация" — падаван, сдавший все 5 испытаний и уже
    прошедший разрыв после 5-го (GRADUATION_GAP_DAYS, см.
    app/crud/jedi_trial.py — физически это 6-е "испытание", та же таблица
    JediTrial, что и 1-5). Валидация при ПОДАЧЕ, тот же паттерн, что у
    _resolve_jedi_trial_target."""
    if not payload.target_discord_id:
        raise AppError("Укажите падавана")

    members = await discord_client.fetch_guild_members()
    target_member = next((m for m in members if m["discord_id"] == payload.target_discord_id), None)
    if target_member is None:
        raise NotFoundError("Участник не найден на сервере")

    target_user = await user_crud.get_by_discord_id_with_rank(db, payload.target_discord_id)
    if target_user is None or target_user.rank is None or target_user.rank.code != "PDW":
        raise AppError(f"{target_member['username']} не в ранге Падавана")

    passed = await jedi_trial_crud.list_for_user(db, user_id=target_user.id)
    trial_number = jedi_trial_crud.next_trial_number(passed)
    if trial_number != jedi_trial_crud.TRIAL_COUNT:
        raise AppError(f"{target_member['username']} ещё не сдал все 5 испытаний")
    available_at = jedi_trial_crud.earliest_available_at(passed, padawan_since=target_user.rank_assigned_at)
    if available_at is not None and datetime.now(timezone.utc) < available_at:
        raise AppError(
            f"Аттестация для {target_member['username']} доступна не раньше "
            f"{available_at.strftime('%d.%m.%Y %H:%M')} МСК"
        )

    return {
        "target_discord_id": target_member["discord_id"],
        "target_username": target_member["username"],
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

    # best-effort per specialization: a limit violation on one shouldn't block the rest
    if category is not None and category.is_training and updated.target_discord_id is not None:
        trainee = await user_crud.get_by_discord_id(db, updated.target_discord_id)
        granted_names = []
        if trainee is not None:
            from app.api.specializations import _check_can_grant

            for specialization_id in updated.training_specialization_ids:
                try:
                    specialization = await specialization_crud.get_by_id(db, specialization_id)
                    if specialization is None:
                        continue
                    await _check_can_grant(db, trainee, specialization)
                    await specialization_crud.grant(
                        db,
                        user_id=trainee.id,
                        specialization_id=specialization_id,
                        granted_by_user_id=actor_user_id,
                    )
                    granted_names.append(f"{specialization.code} — {specialization.name}")
                    logger.info(
                        "Рапорт об обучении %s одобрен — специализация %s выдана %s",
                        updated.id,
                        specialization_id,
                        updated.target_discord_id,
                    )
                except AppError as e:
                    logger.warning("Рапорт об обучении %s одобрен, но специализация %s не выдана: %s", updated.id, specialization_id, e)

            if granted_names:
                await notification_crud.create_personal_notification(
                    db,
                    target_user_id=trainee.id,
                    title="Выдана специализация",
                    body="Вам выдано по итогам обучения: " + ", ".join(granted_names),
                    created_by=actor_user_id,
                )

        # Баллы инструктору — по числу РЕАЛЬНО выданных специализаций (granted_names),
        # а не запрошенных: часть могла отсеяться выше по лимиту (best-effort),
        # или трейни вовсе не найден. Считается одинаково что для авто-одобрения
        # при подаче, что для ручного одобрения командиром черновика — раньше эти
        # два пути расходились (см. историю этой функции).
        per_spec = category.points if category.points is not None else 1
        updated = await report_crud.set_points(db, updated, points=per_spec * len(granted_names))

    # "Курс молодого бойца" — вместо выдачи специализации напрямую меняет
    # звание цели на PVT, тем же паттерном, что и promotion_crud.decide (см.
    # решение пользователя: должен стать PVT одним действием, без отдельного
    # решения командира по PromotionRequest)
    if category is not None and category.is_recruit_promotion and updated.target_discord_id is not None:
        trainee = await user_crud.get_by_discord_id(db, updated.target_discord_id)
        pvt_rank = await rank_crud.get_by_code(db, "PVT")
        if trainee is not None and pvt_rank is not None:
            trainee.rank_id = pvt_rank.id
            trainee.rank_assigned_at = datetime.now(timezone.utc)
            trainee.early_promoted_by_username = None
            trainee.early_promotion_reason = None
            await db.commit()
            # rank_id сменился в обход обычной заявки — гасим зависшую pending,
            # если была (см. app/api/regiments.py::update_member_profile, тот
            # же баг-репорт)
            await promotion_crud.cancel_pending_for_user(
                db, user_id=trainee.id, reason="Пройден Курс молодого бойца"
            )
            await notification_crud.create_personal_notification(
                db,
                target_user_id=trainee.id,
                title="Курс молодого бойца пройден",
                body=f"Вам присвоено звание {pvt_rank.code} — {pvt_rank.name}.",
                created_by=actor_user_id,
            )
            logger.info(
                "Рапорт КМБ %s одобрен — %s повышен до PVT", updated.id, updated.target_discord_id
            )
        elif pvt_rank is None:
            logger.warning("Рапорт КМБ %s одобрен, но звание PVT не настроено", updated.id)

    # "Наставничество" — одобрение отмечает СЛЕДУЮЩЕЕ по порядку испытание
    # падавана сданным; автор рапорта = наставник, получает зачёт в jedi_trials
    # (см. jedi_trial_crud.has_trained_a_padawan — условие для перехода в
    # Мастера). Мягкая перепроверка гейта — статус рапорта уже закоммичен
    # выше, поэтому при несовпадении просто пропускаем и логируем, как и в
    # остальных ветках этой функции, а не роняем весь запрос одобрения.
    if category is not None and category.is_jedi_trial_report and updated.target_discord_id is not None:
        trainee = await user_crud.get_by_discord_id_with_rank(db, updated.target_discord_id)
        if trainee is not None and trainee.rank is not None and trainee.rank.code == "PDW":
            passed = await jedi_trial_crud.list_for_user(db, user_id=trainee.id)
            trial_number = jedi_trial_crud.next_trial_number(passed)
            available_at = jedi_trial_crud.earliest_available_at(passed, padawan_since=trainee.rank_assigned_at)
            now = datetime.now(timezone.utc)
            # <= 5 — 6-е (аттестация) отмечается только веткой
            # is_jedi_attestation_report ниже, не этой категорией
            if trial_number is not None and trial_number <= 5 and (available_at is None or now >= available_at):
                await jedi_trial_crud.mark_passed(
                    db, user_id=trainee.id, trial_number=trial_number, passed_by_user_id=updated.user_id
                )
                await notification_crud.create_personal_notification(
                    db,
                    target_user_id=trainee.id,
                    title="Испытание засчитано",
                    body=f"Испытание {trial_number}/5 отмечено сданным.",
                    created_by=actor_user_id,
                )
                logger.info(
                    "Рапорт наставничества %s одобрен — испытание %s засчитано %s",
                    updated.id, trial_number, updated.target_discord_id,
                )
            else:
                logger.warning(
                    "Рапорт наставничества %s одобрен, но испытание уже нельзя отметить (не ко времени/все сданы)",
                    updated.id,
                )
        else:
            logger.warning("Рапорт наставничества %s одобрен, но цель уже не Падаван", updated.id)

    # "Аттестация" — 6-е и последнее испытание: одобрение отмечает его сданным
    # в jedi_trials (тот же вызов, что и для 1-5) и СРАЗУ меняет ранг цели на
    # Рыцаря — точная копия паттерна is_recruit_promotion выше (см. решение
    # пользователя: одобрение сразу даёт звание Рыцаря, без отдельного шага).
    if category is not None and category.is_jedi_attestation_report and updated.target_discord_id is not None:
        trainee = await user_crud.get_by_discord_id_with_rank(db, updated.target_discord_id)
        if trainee is not None and trainee.rank is not None and trainee.rank.code == "PDW":
            passed = await jedi_trial_crud.list_for_user(db, user_id=trainee.id)
            trial_number = jedi_trial_crud.next_trial_number(passed)
            available_at = jedi_trial_crud.earliest_available_at(passed, padawan_since=trainee.rank_assigned_at)
            now = datetime.now(timezone.utc)
            if trial_number == jedi_trial_crud.TRIAL_COUNT and (available_at is None or now >= available_at):
                await jedi_trial_crud.mark_passed(
                    db, user_id=trainee.id, trial_number=trial_number, passed_by_user_id=updated.user_id
                )
                knight_rank = await rank_crud.get_by_code(db, "KNT")
                if knight_rank is not None:
                    trainee.rank_id = knight_rank.id
                    trainee.rank_assigned_at = now
                    trainee.early_promoted_by_username = None
                    trainee.early_promotion_reason = None
                    await db.commit()
                    await promotion_crud.cancel_pending_for_user(
                        db, user_id=trainee.id, reason="Пройдена аттестация на Рыцаря"
                    )
                    await notification_crud.create_personal_notification(
                        db,
                        target_user_id=trainee.id,
                        title="Аттестация пройдена",
                        body=f"Вам присвоено звание {knight_rank.code} — {knight_rank.name}.",
                        created_by=actor_user_id,
                    )
                    logger.info(
                        "Рапорт аттестации %s одобрен — %s повышен до Рыцаря", updated.id, updated.target_discord_id
                    )
                else:
                    logger.warning("Рапорт аттестации %s одобрен, но звание KNT не настроено", updated.id)
            else:
                logger.warning(
                    "Рапорт аттестации %s одобрен, но аттестацию уже нельзя отметить (не ко времени/уже сдана)",
                    updated.id,
                )
        else:
            logger.warning("Рапорт аттестации %s одобрен, но цель уже не Падаван", updated.id)

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
    if report.mirror_of_report_id is not None:
        raise ForbiddenError("Это зеркальная копия рапорта из другого формирования — статус меняется у исходного")

    is_self_submit = (
        report.user_id == access.user.id
        and report.status == ReportStatus.DRAFT
        and payload.status == ReportStatus.SUBMITTED
        and payload.rejection_reason is None
    )

    is_reject_override = payload.status == ReportStatus.REJECTED and access.can_reject_any_report
    if not access.can_appeal_report(report.regiment_id) and not is_self_submit and not is_reject_override:
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
    if category is not None and category.is_joint and not is_self_submit:
        raise ForbiddenError(
            "Это совместная категория — каждое формирование-участник одобряет свою часть отдельно"
        )

    # only someone who can grant specializations can reject a training report
    if (
        category is not None
        and category.is_training
        and payload.status == ReportStatus.REJECTED
        and not (access.is_admin or access.is_high_command or access.can_grant_specializations or access.can_reject_any_report)
    ):
        raise ForbiddenError("Отклонить рапорт об обучении может только инструктор или администратор")

    was_approved = report.status == ReportStatus.APPROVED

    # Повторное "одобрить" уже одобренного рапорта заново прогоняет
    # _apply_approval_side_effects ниже — для "Наставничества" это молча
    # засчитывает падавану ЕЩЁ одно испытание, которого не было, для
    # "Курса молодого бойца" — повторно обнуляет rank_assigned_at рекрута
    # (баг-репорт). Отклонить уже одобренный рапорт (обжалование) — легитимный
    # путь (see was_approved ниже), поэтому блокируем только повторное APPROVED.
    if payload.status == ReportStatus.APPROVED and was_approved:
        raise AppError("Рапорт уже одобрен — повторное одобрение невозможно")

    # Автоначисление балла категории при одобрении — только если рапорту ещё не
    # выставлен балл вручную, и у его категории задан балл по умолчанию.
    # Обучение — исключение: там балл = баллы_за_спец × число ФАКТИЧЕСКИ
    # выданных специализаций, считается в _apply_approval_side_effects ниже
    # (плоское category.points тут его бы просто перезаписало неверным числом).
    if payload.status == ReportStatus.APPROVED and report.points is None and category is not None:
        if category.points is not None and not category.is_training:
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
    if not is_self_submit and payload.status in (ReportStatus.APPROVED, ReportStatus.REJECTED):
        # self-submit (автор сам отправляет свой черновик) — рутинное действие,
        # не решение командира, в журнал не пишем (см. докстринг AuditLog)
        details = f"Рапорт «{category.name if category else 'без категории'}» -> {payload.status.value}"
        if payload.status == ReportStatus.REJECTED and payload.rejection_reason:
            details += f" ({payload.rejection_reason})"
        await audit_log_crud.log(
            db,
            actor_user_id=access.user.id,
            actor_is_admin=access.is_admin,
            action="report_status_change",
            details=details,
            target_user_id=report.user_id,
        )

    if payload.status == ReportStatus.APPROVED:
        updated = await _apply_approval_side_effects(db, updated, category, access.user.id)
    elif payload.status == ReportStatus.REJECTED and was_approved:
        # appeal on already-approved report: undo participant points so they
        # don't stay double-counted (author's points clear themselves via
        # sum_approved_points, no extra code needed there)
        await report_participant_crud.delete_for_report(db, report_id=updated.id)

    if is_self_submit and category is not None and category.mirrors_to_category_id is not None:
        await _create_mirror_report(db, updated, category)
    elif is_self_submit and category is not None and category.is_joint:
        await _create_joint_decisions(db, updated, category)
    else:
        mirror = await report_crud.get_mirror_of(db, updated.id)
        if mirror is not None:
            await report_crud.sync_mirror_status(
                db,
                mirror,
                status=payload.status,
                updated_by=access.user.id,
                updated_by_rank_id=access.user.rank_id,
                rejection_reason=payload.rejection_reason,
            )

    event_bus.publish("reports")
    return await _to_report_read(db, updated)


@router.patch("/{report_id}/regiments/{regiment_id}", response_model=ReportRead)
async def decide_report_for_regiment(
    report_id: uuid.UUID,
    regiment_id: int,
    payload: RegimentDecisionUpdate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> ReportRead:
    """Решение ОДНОГО формирования-участника по совместному рапорту (см.
    ReportCategory.is_joint) — независимо от решений остальных формирований.
    Одобрение заводит (или переиспользует) read-only копию рапорта в этом
    формировании и начисляет участникам оттуда их долю баллов; отклонение
    снимает и то, и другое, сам рапорт при этом остаётся у формирования-подателя."""
    report = await report_crud.get_by_id(db, report_id)
    if report is None:
        raise NotFoundError("Рапорт не найден")

    category = None
    if report.category_id is not None:
        category = await report_category_crud.get_by_id(db, report.category_id)
    if category is None or not category.is_joint:
        raise ForbiddenError("У этой категории нет отдельных решений по формированиям")

    if not access.can_appeal_report(regiment_id):
        raise ForbiddenError("Изменять решение может только командир этого формирования")

    decision = await report_regiment_decision_crud.get_by_report_and_regiment(
        db, report_id=report_id, regiment_id=regiment_id
    )
    if decision is None:
        raise NotFoundError("Это формирование не участвует в рапорте")

    mirror_report_id = decision.mirror_report_id

    if payload.status == "approved":
        clone_category = await report_category_crud.get_or_create_regiment_clone(
            db, source_category=category, target_regiment_id=regiment_id
        )
        if decision.mirror_report_id is None:
            mirror = await report_crud.create_report(
                db,
                user_id=report.user_id,
                regiment_id=regiment_id,
                category_id=clone_category.id,
                content=report.content,
                status=ReportStatus.APPROVED,
                author_rank_id=report.author_rank_id,
                mirror_of_report_id=report.id,
            )
            mirror_report_id = mirror.id
        else:
            mirror = await report_crud.get_by_id(db, decision.mirror_report_id)
            await report_crud.sync_mirror_status(
                db, mirror, status=ReportStatus.APPROVED, updated_by=access.user.id, updated_by_rank_id=access.user.rank_id
            )

        # Баллы участникам — только той части, что реально из ЭТОГО формирования
        # (не всему списку "Состав", как для обычной категории)
        if category.participant_points and report.participant_discord_ids:
            regiments_by_discord_id = await regiment_crud.resolve_regiments_for_discord_ids(
                db, report.participant_discord_ids
            )
            member_discord_ids = [
                discord_id for discord_id, rids in regiments_by_discord_id.items() if regiment_id in rids
            ]
            if member_discord_ids:
                participants = await user_crud.get_by_discord_ids(db, member_discord_ids)
                for participant in participants:
                    if participant.id == report.user_id:
                        continue
                    await report_participant_crud.award(
                        db, report_id=mirror_report_id, user_id=participant.id, points=category.participant_points
                    )
                    await promotion_crud.check_and_create_promotion_request(db, participant, regiment_id=regiment_id)
    elif decision.mirror_report_id is not None:
        # Отклонение (в том числе повторное после одобрения) — снимаем баллы и
        # статус существующего зеркала; само зеркало не удаляем, чтобы повторное
        # одобрение переиспользовало его, а не плодило дубль
        await report_participant_crud.delete_for_report(db, report_id=decision.mirror_report_id)
        mirror = await report_crud.get_by_id(db, decision.mirror_report_id)
        await report_crud.sync_mirror_status(
            db,
            mirror,
            status=ReportStatus.REJECTED,
            updated_by=access.user.id,
            updated_by_rank_id=access.user.rank_id,
            rejection_reason=payload.rejection_reason,
        )

    status = RegimentDecisionStatus.APPROVED if payload.status == "approved" else RegimentDecisionStatus.REJECTED
    await report_regiment_decision_crud.decide(
        db,
        decision,
        status=status,
        decided_by=access.user.id,
        rejection_reason=payload.rejection_reason,
        mirror_report_id=mirror_report_id,
    )
    logger.info(
        "%s принял решение «%s» по формированию %s для совместного рапорта %s",
        access.user.username,
        status.value,
        regiment_id,
        report_id,
    )
    event_bus.publish("reports")
    return await _to_report_read(db, report)


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
    if report.mirror_of_report_id is not None:
        raise ForbiddenError("Это зеркальная копия рапорта из другого формирования — удаляется у исходного")

    is_own_draft = report.user_id == access.user.id and report.status == ReportStatus.DRAFT
    was_approved = report.status == ReportStatus.APPROVED

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
    elif category is not None and category.is_joint:
        # решения формирований по совместному рапорту уже приняты независимо —
        # отменить всё разом может только высшее командование/админ, не любой
        # командир формирования-подателя
        if not (access.is_admin or access.is_high_command):
            raise ForbiddenError("Удалить совместный рапорт может только высшее командование или администратор")
    elif not access.can_appeal_report(report.regiment_id):
        raise ForbiddenError("Удалять рапорт может только командир формирования")

    if was_approved:
        # как и при отклонении уже одобренного рапорта (update_report_status) — не
        # оставляем участникам задвоенные баллы за аннулированный рапорт
        await report_participant_crud.delete_for_report(db, report_id=report.id)

    deleted = await report_crud.soft_delete(db, report, updated_by=access.user.id)
    # и обычные 1:1 зеркала (mirrors_to_category_id), и совместные per-regiment
    # зеркала (is_joint) — снимаются все разом вслед за исходным рапортом
    for mirror in await report_crud.list_mirrors_of(db, deleted.id):
        await report_participant_crud.delete_for_report(db, report_id=mirror.id)
        await report_crud.sync_mirror_status(
            db, mirror, status=ReportStatus.DELETED, updated_by=access.user.id, updated_by_rank_id=access.user.rank_id
        )
    logger.info("%s удалил рапорт %s", access.user.username, report_id)
    if not is_own_draft and (category is None or not category.is_detention):
        # аннулирование задержания уже залогировано отдельно (detention_report_delete)
        # выше по коду — здесь остальные случаи (не свой черновик)
        await audit_log_crud.log(
            db,
            actor_user_id=access.user.id,
            actor_is_admin=access.is_admin,
            action="report_delete",
            details=f"Удалил рапорт «{category.name if category else 'без категории'}» (формирование {report.regiment_id})",
            target_user_id=report.user_id,
        )
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
    или администратор; для рапорта об обучении — также инструктор."""
    report = await report_crud.get_by_id(db, report_id)
    if report is None:
        raise NotFoundError("Рапорт не найден")

    category = await report_category_crud.get_by_id(db, report.category_id) if report.category_id else None
    is_training = category is not None and category.is_training

    if is_training:
        if not (access.is_full_commander_of(report.regiment_id) or access.can_grant_specializations):
            raise ForbiddenError("Выставлять баллы может только инструктор, командир формирования или администратор")
    elif not access.is_full_commander_of(report.regiment_id):
        raise ForbiddenError("Выставлять баллы может только командир формирования")

    updated = await report_crud.set_points(db, report, points=payload.points)
    logger.info("%s выставил %s баллов рапорту %s", access.user.username, payload.points, report_id)
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="report_points_set",
        details=f"Выставил {payload.points} баллов рапорту «{category.name if category else 'без категории'}»",
        target_user_id=report.user_id,
    )

    # points may change after approval, recheck promotion eligibility
    if updated.status == ReportStatus.APPROVED:
        await promotion_crud.check_and_create_promotion_request(db, updated.author, regiment_id=updated.regiment_id)
    event_bus.publish("promotions")
    event_bus.publish("reports")
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

    content, ext = await read_image_upload(file, allowed_types=ALLOWED_IMAGE_TYPES, max_size=MAX_IMAGE_SIZE)

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
