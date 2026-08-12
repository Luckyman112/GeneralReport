"""Администрация — нон-РП должность (модерация сервера), независимая от
РП-формирований (см. app/models/app_settings.py::admin_staff_*_role_id).
"Отчёт деятельности"/"Отчёт наказаний" — отдельная от Report/ReportCategory
сущность, тот же принцип, что у Event/Ивентрума (см. app/models/admin_report.py)."""
import logging
import uuid
from datetime import datetime, timedelta
from pathlib import Path

from fastapi import APIRouter, Depends, File, Query, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AccessContext, get_access_context
from app.core import discord_client
from app.core.uploads import read_file_upload, read_image_upload
from app.crud import admin_report as admin_report_crud
from app.crud import admin_reprimand as admin_reprimand_crud
from app.crud import app_settings as app_settings_crud
from app.crud import audit_log as audit_log_crud
from app.crud import regiment as regiment_crud
from app.crud import user as user_crud
from app.database import get_db
from app.exceptions import AppError, ForbiddenError, NotFoundError
from app.schemas.admin_report import (
    AdminActivitySummaryEntry,
    AdminActivityTrendRead,
    AdminActivityTrendSeries,
    AdminMemberDetail,
    AdminReportCreate,
    AdminReportDecide,
    AdminReportRead,
)
from app.schemas.admin_reprimand import AdminReprimandCreate, AdminReprimandRead
from app.schemas.regiment_commander import GuildMemberRead

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin-reports", tags=["admin-reports"])

_UPLOAD_ROOT = Path(__file__).resolve().parent.parent.parent / "uploads" / "admin-reports"
_ALLOWED_IMAGE_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
_ALLOWED_VIDEO_TYPES = {"video/mp4": ".mp4", "video/webm": ".webm"}
_MAX_IMAGE_SIZE = 5 * 1024 * 1024  # 5 МБ, как везде в проекте
_MAX_VIDEO_SIZE = 50 * 1024 * 1024  # 50 МБ

# Порядок важен — старшая должность побеждает, если у бойца несколько ролей разом
_RANK_LABELS = [
    ("curator", "Куратор Администрации"),
    ("assistant", "Ассистент Администрации"),
    ("warden", "Варден Администратор"),
    ("middle", "Администратор"),
    ("junior", "Младший Администратор"),
]


def _require_admin_staff(access: AccessContext) -> None:
    if not (access.is_admin_staff or access.is_admin):
        raise ForbiddenError("Доступно только персоналу Администрации")


@router.get("", response_model=list[AdminReportRead])
async def list_admin_reports(
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[AdminReportRead]:
    _require_admin_staff(access)
    if access.can_decide_admin_report:
        reports = await admin_report_crud.list_all(db)
    else:
        reports = await admin_report_crud.list_all(db, submitted_by_user_id=access.user.id)
    return [AdminReportRead.model_validate(r) for r in reports]


@router.post("", response_model=AdminReportRead, status_code=201)
async def create_admin_report(
    payload: AdminReportCreate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> AdminReportRead:
    _require_admin_staff(access)
    report = await admin_report_crud.create(
        db, report_type=payload.report_type, payload=payload.payload, submitted_by_user_id=access.user.id
    )
    logger.info("%s подал отчёт Администрации (%s)", access.user.username, payload.report_type)
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="admin_report_create",
        details=f"Отчёт Администрации {report.id} ({payload.report_type})",
    )
    return AdminReportRead.model_validate(report)


@router.patch("/{report_id}", response_model=AdminReportRead)
async def decide_admin_report(
    report_id: int,
    payload: AdminReportDecide,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> AdminReportRead:
    if not access.can_decide_admin_report:
        raise ForbiddenError("Одобрять отчёты Администрации может Senior+ или ответственный Middle")
    report = await admin_report_crud.get_by_id(db, report_id)
    if report is None:
        raise NotFoundError("Отчёт не найден")
    updated = await admin_report_crud.decide(
        db,
        report,
        approve=payload.status == "approved",
        decided_by_user_id=access.user.id,
        rejection_reason=payload.rejection_reason,
    )
    logger.info("%s решил по отчёту Администрации %s: %s", access.user.username, report_id, payload.status)
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="admin_report_decide",
        details=f"Отчёт Администрации {report_id} ({report.report_type}) -> {payload.status}",
    )
    return AdminReportRead.model_validate(updated)


@router.post("/attachments")
async def upload_admin_report_attachment(
    file: UploadFile = File(...),
    access: AccessContext = Depends(get_access_context),
) -> dict:
    """Скриншот/видео-доказательство — просто возвращает URL, фронт кладёт его
    в payload отчёта (payload — свободный словарь, см. AdminReport.payload)."""
    _require_admin_staff(access)
    if file.content_type in _ALLOWED_IMAGE_TYPES:
        content, ext = await read_image_upload(file, allowed_types=_ALLOWED_IMAGE_TYPES, max_size=_MAX_IMAGE_SIZE)
    elif file.content_type in _ALLOWED_VIDEO_TYPES:
        content, ext = await read_file_upload(file, allowed_types=_ALLOWED_VIDEO_TYPES, max_size=_MAX_VIDEO_SIZE)
    else:
        raise AppError("Разрешены только изображения (jpg/png/webp) или видео (mp4/webm)")

    _UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4()}{ext}"
    (_UPLOAD_ROOT / filename).write_bytes(content)
    return {"url": f"/uploads/admin-reports/{filename}"}


@router.get("/member-candidates", response_model=list[GuildMemberRead])
async def get_member_candidates(
    access: AccessContext = Depends(get_access_context),
) -> list[GuildMemberRead]:
    """Весь состав сервера — для выбора цели наказания в "Отчёт наказаний"
    (Администрация не привязана к формированию, цель может быть из любого —
    см. решение пользователя; копия event_room.py::get_member_candidates)."""
    _require_admin_staff(access)
    members = await discord_client.fetch_guild_members()
    return [
        GuildMemberRead(discord_id=m["discord_id"], username=m["username"], discord_username=m["username"], avatar_url=m["avatar_url"])
        for m in members
    ]


@router.get("/activity-trend", response_model=AdminActivityTrendRead)
async def get_activity_trend(
    since: datetime = Query(...),
    until: datetime = Query(...),
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> AdminActivityTrendRead:
    """График активности (TrendChart на фронте) — Деятельность/Наказания по
    дням за произвольный диапазон (см. решение пользователя: неделя/месяц/
    свои даты)."""
    _require_admin_staff(access)
    if until <= since:
        raise AppError("Некорректный диапазон дат")

    by_day = await admin_report_crud.daily_type_counts(db, since=since, until=until)
    # Полный список дней диапазона, а не только те, где есть данные — иначе
    # нулевые дни выпадали бы из графика
    dates = []
    cur = since.date()
    last_day = until.date()
    while cur <= last_day:
        dates.append(cur.isoformat())
        cur += timedelta(days=1)

    return AdminActivityTrendRead(
        dates=dates,
        series=[
            AdminActivityTrendSeries(
                id="activity", label="Деятельность", points=[by_day.get(d, {}).get("activity", 0) for d in dates]
            ),
            AdminActivityTrendSeries(
                id="punishment", label="Наказания", points=[by_day.get(d, {}).get("punishment", 0) for d in dates]
            ),
        ],
    )


@router.get("/activity-summary", response_model=list[AdminActivitySummaryEntry])
async def get_activity_summary(
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[AdminActivitySummaryEntry]:
    """Кол-во одобренных отчётов за 7д/30д/всё время + дата последнего — для
    каждого текущего носителя одной из 5 ролей Администрации (живой ростер,
    как везде в проекте — членство не хранится в БД)."""
    _require_admin_staff(access)

    app_config = await app_settings_crud.get(db)
    role_ids_by_rank = {
        "junior": app_config.admin_staff_junior_role_id,
        "middle": app_config.admin_staff_middle_role_id,
        "warden": app_config.admin_staff_warden_role_id,
        "assistant": app_config.admin_staff_assistant_role_id,
        "curator": app_config.admin_staff_curator_role_id,
    }
    rank_label_by_code = dict(_RANK_LABELS)

    members = await discord_client.fetch_guild_members()
    staff_members = []
    for member in members:
        member_role_ids = set(member.get("roles") or [])
        rank_code = next(
            (code for code, _ in _RANK_LABELS if role_ids_by_rank.get(code) in member_role_ids), None
        )
        if rank_code is not None:
            staff_members.append((member, rank_code))
    if not staff_members:
        return []

    users = await user_crud.get_by_discord_ids(db, [m["discord_id"] for m, _ in staff_members])
    user_by_discord_id = {u.discord_id: u for u in users}

    user_ids = [user_by_discord_id[m["discord_id"]].id for m, _ in staff_members if m["discord_id"] in user_by_discord_id]
    stats_by_user_id = await admin_report_crud.activity_summary_for_user_ids(db, user_ids)
    active_reprimands_by_user_id = await admin_reprimand_crud.count_active_for_user_ids(db, user_ids)

    entries = []
    for member, rank_code in staff_members:
        user = user_by_discord_id.get(member["discord_id"])
        stats = stats_by_user_id.get(user.id) if user else None
        entries.append(
            AdminActivitySummaryEntry(
                discord_id=member["discord_id"],
                username=member["username"],
                rank_code=rank_code,
                rank_label=rank_label_by_code[rank_code],
                activity_count_week=stats["activity_count_week"] if stats else 0,
                activity_count_month=stats["activity_count_month"] if stats else 0,
                activity_count_all_time=stats["activity_count_all_time"] if stats else 0,
                punishment_count_week=stats["punishment_count_week"] if stats else 0,
                punishment_count_month=stats["punishment_count_month"] if stats else 0,
                punishment_count_all_time=stats["punishment_count_all_time"] if stats else 0,
                last_report_at=stats["last_report_at"] if stats else None,
                active_reprimand_count=active_reprimands_by_user_id.get(user.id, 0) if user else 0,
            )
        )
    return entries


@router.get("/roster/{discord_id}", response_model=AdminMemberDetail)
async def get_admin_roster_member_detail(
    discord_id: str,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> AdminMemberDetail:
    """Досье по клику на ник в сводке активности — рапорта Администрации
    этого бойца, раздельно деятельность/наказания, плюс regiment_id/
    regiment_name (если человек реально состоит в каком-то формировании) для
    переключателя Администрация/РП на фронте (см. решение пользователя, п.6/
    п.8; тот же приём, что event_room.py::get_roster_member_detail)."""
    _require_admin_staff(access)

    app_config = await app_settings_crud.get(db)
    role_ids_by_rank = {
        "junior": app_config.admin_staff_junior_role_id,
        "middle": app_config.admin_staff_middle_role_id,
        "warden": app_config.admin_staff_warden_role_id,
        "assistant": app_config.admin_staff_assistant_role_id,
        "curator": app_config.admin_staff_curator_role_id,
    }
    rank_label_by_code = dict(_RANK_LABELS)

    members = await discord_client.fetch_guild_members()
    member = next((m for m in members if m["discord_id"] == discord_id), None)
    if member is None:
        raise NotFoundError("Участник не найден")
    member_role_ids = set(member.get("roles") or [])
    rank_code = next(
        (code for code, role_id in role_ids_by_rank.items() if role_id in member_role_ids), None
    )
    if rank_code is None:
        raise NotFoundError("Участник не входит в состав Администрации")

    user = await user_crud.get_by_discord_id_with_rank(db, discord_id)
    activity_reports: list[AdminReportRead] = []
    punishment_reports: list[AdminReportRead] = []
    reprimands: list[AdminReprimandRead] = []
    if user is not None:
        reports = await admin_report_crud.list_all(db, submitted_by_user_id=user.id)
        activity_reports = [AdminReportRead.model_validate(r) for r in reports if r.report_type == "activity"]
        punishment_reports = [AdminReportRead.model_validate(r) for r in reports if r.report_type == "punishment"]
        reprimands = [
            AdminReprimandRead.model_validate(r) for r in await admin_reprimand_crud.list_for_target(db, target_user_id=user.id)
        ]

    regiment_id = None
    regiment_name = None
    regiment_map = await regiment_crud.resolve_regiments_for_discord_ids(db, [discord_id])
    regiment_ids = regiment_map.get(discord_id) or []
    if regiment_ids:
        regiment = await regiment_crud.get_by_id(db, regiment_ids[0])
        if regiment is not None:
            regiment_id = regiment.id
            regiment_name = regiment.name

    return AdminMemberDetail(
        discord_id=discord_id,
        username=member["username"],
        rank_code=rank_code,
        rank_label=rank_label_by_code[rank_code],
        regiment_id=regiment_id,
        regiment_name=regiment_name,
        activity_reports=activity_reports,
        punishment_reports=punishment_reports,
        reprimands=reprimands,
    )


@router.post("/reprimands", response_model=AdminReprimandRead, status_code=201)
async def issue_admin_reprimand(
    payload: AdminReprimandCreate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> AdminReprimandRead:
    """Выдать выговор Администрации — тот же гейт, что решает отчёты (старший
    состав), Администрация не привязана к формированию (см. решение
    пользователя, п.7)."""
    if not access.can_decide_admin_report:
        raise ForbiddenError("Выдавать выговоры Администрации может Senior+ или ответственный Middle")

    members = await discord_client.fetch_guild_members()
    target = next((m for m in members if m["discord_id"] == payload.target_discord_id), None)
    if target is None:
        raise NotFoundError("Участник не найден на сервере")

    target_user = await user_crud.get_by_discord_id(db, payload.target_discord_id)
    if target_user is None:
        target_user = await user_crud.update_profile(
            db, discord_id=payload.target_discord_id, fallback_username=target["username"], changes={}
        )

    reprimand = await admin_reprimand_crud.create(
        db,
        target_user_id=target_user.id,
        reason=payload.reason,
        severity=payload.severity,
        issued_by_user_id=access.user.id,
    )
    logger.info(
        "%s выдал %s выговор Администрации участнику %s: %s",
        access.user.username, payload.severity, target["username"], payload.reason,
    )
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="admin_reprimand_issue",
        details=f"Выдал {payload.severity} выговор Администрации {target['username']} ({payload.reason})",
    )
    return AdminReprimandRead.model_validate(reprimand)


@router.delete("/reprimands/{reprimand_id}", status_code=204)
async def revoke_admin_reprimand(
    reprimand_id: int,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> None:
    if not access.can_decide_admin_report:
        raise ForbiddenError("Снимать выговоры Администрации может Senior+ или ответственный Middle")
    reprimand = await admin_reprimand_crud.get_by_id(db, reprimand_id)
    if reprimand is None:
        raise NotFoundError("Выговор не найден")

    await admin_reprimand_crud.revoke(db, reprimand, revoked_by_user_id=access.user.id)
    logger.info("%s снял выговор Администрации %s", access.user.username, reprimand_id)
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="admin_reprimand_revoke",
        details=f"Снял выговор Администрации #{reprimand_id}",
    )
