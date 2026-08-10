"""Отчёты Ивентологов о проведённых мероприятиях (Мини-ивент / Боевой вылет) —
отдельная от Event (заявка/бронь ДО ивента) сущность, тот же принцип freeform
payload, что у Event/AdminReport (см. app/models/event_activity_report.py)."""
import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AccessContext, get_access_context
from app.core import discord_client
from app.core.uploads import read_image_upload
from app.crud import app_settings as app_settings_crud
from app.crud import audit_log as audit_log_crud
from app.crud import event_activity_report as activity_report_crud
from app.crud import user as user_crud
from app.database import get_db
from app.exceptions import ForbiddenError, NotFoundError
from app.schemas.event_activity_report import (
    EventActivitySummaryEntry,
    EventActivityReportCreate,
    EventActivityReportDecide,
    EventActivityReportRead,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/event-activity-reports", tags=["event-activity-reports"])

_UPLOAD_ROOT = Path(__file__).resolve().parent.parent.parent / "uploads" / "event-activity-reports"
_ALLOWED_IMAGE_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
_MAX_IMAGE_SIZE = 5 * 1024 * 1024  # 5 МБ

# Порядок важен — старшая ступень побеждает, если у человека несколько ролей разом
_RANK_LABELS = [
    ("curator", "Куратор ивентологии"),
    ("assistant", "Ассистент ивентологии"),
    ("senior", "Старший Ивентолог"),
    ("regular", "Ивентолог"),
    ("junior", "Младший Ивентолог"),
]


def _require_submitter(access: AccessContext) -> None:
    if not access.is_event_submitter:
        raise ForbiddenError("Доступно только Ивентологам")


@router.get("", response_model=list[EventActivityReportRead])
async def list_activity_reports(
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[EventActivityReportRead]:
    _require_submitter(access)
    if access.can_decide_event:
        reports = await activity_report_crud.list_all(db)
    else:
        reports = await activity_report_crud.list_all(db, submitted_by_user_id=access.user.id)
    return [EventActivityReportRead.model_validate(r) for r in reports]


@router.post("", response_model=EventActivityReportRead, status_code=201)
async def create_activity_report(
    payload: EventActivityReportCreate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> EventActivityReportRead:
    _require_submitter(access)
    report = await activity_report_crud.create(
        db, event_type=payload.event_type, payload=payload.payload, submitted_by_user_id=access.user.id
    )
    logger.info("%s подал отчёт о мероприятии (%s)", access.user.username, payload.event_type)
    return EventActivityReportRead.model_validate(report)


@router.patch("/{report_id}", response_model=EventActivityReportRead)
async def decide_activity_report(
    report_id: int,
    payload: EventActivityReportDecide,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> EventActivityReportRead:
    if not access.can_decide_event:
        raise ForbiddenError("Одобрять отчёты о мероприятиях может Ассистент/Куратор ивентологии")
    report = await activity_report_crud.get_by_id(db, report_id)
    if report is None:
        raise NotFoundError("Отчёт не найден")
    updated = await activity_report_crud.decide(
        db,
        report,
        approve=payload.status == "approved",
        decided_by_user_id=access.user.id,
        rejection_reason=payload.rejection_reason,
    )
    logger.info("%s решил по отчёту о мероприятии %s: %s", access.user.username, report_id, payload.status)
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="event_activity_report_decide",
        details=f"Отчёт о мероприятии {report_id} ({report.event_type}) -> {payload.status}",
    )
    return EventActivityReportRead.model_validate(updated)


@router.post("/attachments")
async def upload_activity_report_attachment(
    file: UploadFile = File(...),
    access: AccessContext = Depends(get_access_context),
) -> dict:
    _require_submitter(access)
    content, ext = await read_image_upload(file, allowed_types=_ALLOWED_IMAGE_TYPES, max_size=_MAX_IMAGE_SIZE)
    _UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4()}{ext}"
    (_UPLOAD_ROOT / filename).write_bytes(content)
    return {"url": f"/uploads/event-activity-reports/{filename}"}


@router.get("/activity-summary", response_model=list[EventActivitySummaryEntry])
async def get_activity_summary(
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[EventActivitySummaryEntry]:
    """Кол-во одобренных отчётов за 7д/30д/всё время + дата последнего — для
    каждого текущего носителя одной из 5 ступеней лестницы Ивентрума (живой
    ростер, как везде в проекте)."""
    _require_submitter(access)

    app_config = await app_settings_crud.get(db)
    role_ids_by_rank = {
        "junior": app_config.event_junior_role_id,
        "regular": app_config.event_role_id,
        "senior": app_config.event_senior_role_id,
        "assistant": app_config.event_assistant_role_id,
        "curator": app_config.event_curator_role_id,
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
    stats_by_user_id = await activity_report_crud.activity_summary_for_user_ids(db, user_ids)

    entries = []
    for member, rank_code in staff_members:
        user = user_by_discord_id.get(member["discord_id"])
        stats = stats_by_user_id.get(user.id) if user else None
        entries.append(
            EventActivitySummaryEntry(
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
