"""Администрация — нон-РП должность (модерация сервера), независимая от
РП-формирований (см. app/models/app_settings.py::admin_staff_*_role_id).
"Отчёт деятельности"/"Отчёт наказаний" — отдельная от Report/ReportCategory
сущность, тот же принцип, что у Event/Ивентрума (см. app/models/admin_report.py)."""
import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AccessContext, get_access_context
from app.core import discord_client
from app.core.uploads import read_file_upload, read_image_upload
from app.crud import admin_report as admin_report_crud
from app.crud import app_settings as app_settings_crud
from app.crud import audit_log as audit_log_crud
from app.crud import notification as notification_crud
from app.crud import user as user_crud
from app.database import get_db
from app.exceptions import AppError, ForbiddenError, NotFoundError
from app.schemas.admin_report import (
    AdminActivitySummaryEntry,
    AdminReportCreate,
    AdminReportDecide,
    AdminReportRead,
)

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
    await notification_crud.create_personal_notification(
        db,
        target_user_id=updated.submitted_by_user_id,
        title="Отчёт Администрации одобрен" if payload.status == "approved" else "Отчёт Администрации отклонён",
        body=f"Ваш отчёт ({report.report_type}) {'одобрен' if payload.status == 'approved' else 'отклонён'}."
        + (f" Причина: {payload.rejection_reason}" if payload.status == "rejected" and payload.rejection_reason else ""),
        created_by=access.user.id,
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
                count_week=stats["count_week"] if stats else 0,
                count_month=stats["count_month"] if stats else 0,
                count_all_time=stats["count_all_time"] if stats else 0,
                last_report_at=stats["last_report_at"] if stats else None,
            )
        )
    return entries
