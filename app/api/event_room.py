"""Ивентрум — заявки на ивенты от Ивентологов, одобряет Ассистент/Куратор
ивентологии; при одобрении бот отправляет карточку операции в настроенный
Discord-канал (см. app/core/discord_client.py::send_channel_message).
Отдельная от Report сущность/UI — набор полей задаётся на фронте, не
конструктором в БД (см. Event.payload), см. решение пользователя."""
import logging
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from typing import Literal

from fastapi import APIRouter, Depends, File, Query, Response, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AccessContext, get_access_context
from app.core import discord_client
from app.core.event_card import render_operation_dossier
from app.core.events import event_bus
from app.core.uploads import read_image_upload
from app.crud import admin_reprimand as admin_reprimand_crud
from app.crud import app_settings as app_settings_crud
from app.crud import audit_log as audit_log_crud
from app.crud import event as event_crud
from app.crud import event_activity_report as activity_report_crud
from app.crud import event_message as event_message_crud
from app.crud import notification as notification_crud
from app.crud import regiment as regiment_crud
from app.crud import user as user_crud
from app.database import get_db
from app.exceptions import AppError, ForbiddenError, NotFoundError
from app.schemas.admin_reprimand import AdminReprimandRead
from app.schemas.event import (
    EventCancelRequest,
    EventCreate,
    EventMapCreate,
    EventMapRead,
    EventMapUpdate,
    EventMemberDetail,
    EventPlanetBadge,
    EventRead,
    EventRejectRequest,
    EventRevisionRequest,
    EventRosterEntry,
    EventUpdate,
)
from app.schemas.event_activity_report import (
    EventActivityReportRead,
    EventActivityTrendRead,
    EventActivityTrendSeries,
)
from app.schemas.event_message import EventMessageCreate, EventMessageDecide, EventMessageRead
from app.schemas.rank import RankRead
from app.schemas.regiment_commander import GuildMemberRead

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/event-room", tags=["event-room"])


KIND_LABELS = {"event": "Заявка на ивент", "rp": "РП ивент", "mini": "Миник"}


def format_mini_message(payload: dict) -> str:
    """Миник — сообщение «на коммуникатор бойцов», шаблон ивентологов. Тот же
    текст показывает предпросмотр формы на фронте (eventroom/requestForms.jsx)."""
    def val(key: str) -> str:
        return str(payload.get(key) or "").strip()

    return (
        "[ На коммуникатор бойцов пришло сообщение ]\n\n"
        f"От кого: {val('sender')}\n"
        f"Кому: {val('recipient')}\n\n"
        f"Сообщение: {val('message')}\n\n"
        f"[Время: {val('time')}]"
    )


def _kind_channel(app_config, kind: str) -> str | None:
    """Миник уходит в канал коммуникатора (если он задан), остальное — в канал
    уведомлений об ивентах."""
    if kind == "mini":
        return app_config.event_comms_channel_id or app_config.event_notify_channel_id
    return app_config.event_notify_channel_id


async def _build_rp_embed(db: AsyncSession, row) -> dict:
    payload = row.payload or {}
    regiments = await regiment_crud.get_all(db)
    regiments_by_id = {r.id: r for r in regiments}
    fields = []

    def add_field(name: str, value, inline: bool = True):
        if value in (None, ""):
            return
        fields.append({"name": name, "value": str(value)[:1024], "inline": inline})

    add_field("🕐 Начало", _format_datetime(payload.get("briefing_start")))
    add_field("👤 Проводящий", f"<@{row.submitted_by.discord_id}>")
    add_field("📍 Место", payload.get("planet_name"))
    add_field(
        "👥 Участники",
        _format_audience(payload.get("participants"), regiments_by_id, plain=False, members_by_id={}),
        inline=False,
    )
    add_field("📝 Дополнительно", payload.get("notes"), inline=False)
    return {
        "title": f"🎭 РП ивент — {row.title}",
        "description": str(payload.get("summary") or "")[:4000] or None,
        "color": 0x8E5BD6,
        "fields": fields,
        "footer": {"text": f"COLLAPSAR · Ивентрум · Заявка #{row.id}"},
    }


async def _deliver(db: AsyncSession, row, *, new: bool, cancelled: bool = False) -> tuple[str, str | None]:
    """Отправить сообщение заявки в Discord (new=True) или обновить уже
    отправленное. Вид сообщения зависит от типа заявки: ивент — карточка-досье
    с картинкой и пингом роли, РП ивент — карточка без картинки с пингом,
    миник — простой текст без пинга. Возвращает (канал, id сообщения)."""
    app_config = await app_settings_crud.get(db)
    channel = (None if new else row.discord_channel_id) or _kind_channel(app_config, row.kind)
    if not channel:
        raise AppError("Канал для отправки не настроен (Настройки → Ивентрум)")

    content: str | None = None
    embed: dict | None = None
    image: bytes | None = None
    if row.kind == "mini":
        content = format_mini_message(row.payload or {})
        if cancelled:
            content = "❌ ОТМЕНЕНО\n" + content
    elif row.kind == "rp":
        embed = await _build_rp_embed(db, row)
        content = _message_content(app_config)
    else:
        map_row = await _get_selected_map(db, row)
        embed = _build_event_embed(row, map_row)
        image = await _render_event_image(db, event_id=row.id, title=row.title, payload=row.payload or {})
        content = _message_content(app_config)
    if cancelled and embed is not None:
        embed["title"] = f"❌ ОТМЕНЕНО — {row.title}"
        embed["color"] = 0xB33A3A
    if embed is not None and not embed.get("description"):
        embed.pop("description", None)

    filename = f"operation-{row.id}.png"
    if new or not row.discord_message_id:
        if image is not None:
            message_id = await discord_client.send_channel_message_with_file(
                channel, embed=embed, file_bytes=image, filename=filename, content=content
            )
        else:
            message_id = await discord_client.send_channel_message(channel, content=content, embed=embed)
        return channel, message_id
    if image is not None:
        await discord_client.edit_channel_message(
            channel, row.discord_message_id, embed=embed, file_bytes=image, filename=filename, content=content
        )
    else:
        await discord_client.edit_channel_message_text(channel, row.discord_message_id, content=content, embed=embed)
    return channel, row.discord_message_id


# "летят те, кем командует тот" — командующего часто узнают только по ходу
# брифинга, не до подачи заявки (см. решение пользователя)
_COMMANDER_TBD = "Определится на брифинге"

_UPLOAD_ROOT = Path(__file__).resolve().parent.parent.parent / "uploads" / "events"
_ALLOWED_IMAGE_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
_MAX_IMAGE_SIZE = 5 * 1024 * 1024  # 5 МБ, как у картинок рапортов


async def _event_to_read(db: AsyncSession, row) -> EventRead:
    messages = await event_message_crud.list_for_event(db, event_id=row.id)
    read = EventRead.model_validate(row)
    read.messages = [EventMessageRead.model_validate(m) for m in messages]
    return read


async def _events_to_read(db: AsyncSession, rows: list) -> list[EventRead]:
    messages_by_event = await event_message_crud.list_for_events(db, event_ids=[r.id for r in rows])
    result = []
    for row in rows:
        read = EventRead.model_validate(row)
        read.messages = [EventMessageRead.model_validate(m) for m in messages_by_event.get(row.id, [])]
        result.append(read)
    return result


@router.get("", response_model=list[EventRead])
async def list_events(
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[EventRead]:
    if access.can_decide_event:
        rows = await event_crud.list_all(db)
    elif access.is_event_submitter:
        rows = await event_crud.list_all(db, submitted_by_user_id=access.user.id)
    else:
        raise ForbiddenError("Ивентрум доступен только Ивентологам, Ассистентам и Куратору ивентологии")
    return await _events_to_read(db, rows)


@router.get("/planet-badges", response_model=list[EventPlanetBadge])
async def list_planet_badges(
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[EventPlanetBadge]:
    # Намеренно доступно любому с доступом к сайту (не только Ивентрум-ролям)
    # — тонкий мостик с "Галактикой" (см. CLAUDE.md), которая тоже видна всем
    # зарегистрированным. Отдаём только planet_name/title/briefing_start, не
    # весь payload.
    if not access.has_access:
        raise ForbiddenError("Нет доступа")
    rows = await event_crud.list_approved_with_planet(db)
    return [
        EventPlanetBadge(
            planet_name=str(row.payload.get("planet_name") or "").strip(),
            title=row.title,
            briefing_start=row.payload.get("briefing_start"),
        )
        for row in rows
    ]


@router.post("", response_model=EventRead, status_code=201)
async def create_event(
    payload: EventCreate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> EventRead:
    if not access.is_event_submitter:
        raise ForbiddenError("Подавать заявки на ивент может только Ивентолог, Ассистент/Куратор ивентологии или создатель")

    row = await event_crud.create(
        db, title=payload.title.strip(), kind=payload.kind, payload=payload.payload, submitted_by_user_id=access.user.id
    )
    logger.info("%s подал заявку (%s) «%s»", access.user.username, payload.kind, row.title)
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="event_create",
        details=f"Подал заявку «{KIND_LABELS.get(row.kind, row.kind)}» «{row.title}» (#{row.id})",
    )
    event_bus.publish("event_room")
    return await _event_to_read(db, row)


@router.get("/member-candidates", response_model=list[GuildMemberRead])
async def get_member_candidates(
    access: AccessContext = Depends(get_access_context),
) -> list[GuildMemberRead]:
    """Весь состав сервера — для выбора участников/приписки/командующего в
    заявке на ивент (доступно и Ивентологу, не только куратору/ассистенту)."""
    if not access.can_access_event_room:
        raise ForbiddenError("Ивентрум доступен только Ивентологам, Ассистентам и Куратору ивентологии")
    members = await discord_client.fetch_guild_members()
    return [
        GuildMemberRead(discord_id=m["discord_id"], username=m["username"], discord_username=m["username"], avatar_url=m["avatar_url"])
        for m in members
    ]


def _aware(value: datetime | None) -> datetime | None:
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


@router.get("/roster", response_model=list[EventRosterEntry])
async def get_roster(
    since: datetime | None = Query(None),
    until: datetime | None = Query(None),
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[EventRosterEntry]:
    """Состав Ивентрума (5 ступеней) с их статистикой — и по заявкам на ивент
    (сколько подал/одобрено/отклонено), и по отчётам о проведённых
    мероприятиях (за неделю/месяц/всё время + дата последнего) — единая
    таблица (см. решение пользователя, было две разные)."""
    if not access.can_access_event_room:
        raise ForbiddenError("Ивентрум доступен только Ивентологам, Ассистентам и Куратору ивентологии")

    app_config = await app_settings_crud.get(db)
    # старше по списку — побеждает, если роли совмещены (см. ниже next())
    role_labels = {
        app_config.event_curator_role_id: "куратор",
        app_config.event_assistant_role_id: "ассистент",
        app_config.event_senior_role_id: "старший ивентолог",
        app_config.event_role_id: "ивентолог",
        app_config.event_junior_role_id: "младший ивентолог",
    }
    role_labels.pop(None, None)
    if not role_labels:
        return []

    since, until = _aware(since), _aware(until)
    members = await discord_client.fetch_guild_members()
    all_events = await event_crud.list_all(db)
    counts: dict[str, dict[str, int]] = {}
    for ev in all_events:
        # заявки тоже считаются только за выбранный период (баг-репорт: столбцы
        # "подано/одобрено/отклонено" раньше всегда показывали всё время)
        if since is not None and ev.created_at < since:
            continue
        if until is not None and ev.created_at >= until:
            continue
        discord_id = ev.submitted_by.discord_id
        bucket = counts.setdefault(discord_id, {"submitted": 0, "approved": 0, "rejected": 0})
        bucket["submitted"] += 1
        if ev.status == "approved":
            bucket["approved"] += 1
        elif ev.status == "rejected":
            bucket["rejected"] += 1

    matched_members = []
    for member in members:
        member_role_ids = set(member.get("roles") or [])
        role = next((label for role_id, label in role_labels.items() if role_id in member_role_ids), None)
        if role is not None:
            matched_members.append((member, role))
    if not matched_members:
        return []

    users = await user_crud.get_by_discord_ids(db, [m["discord_id"] for m, _ in matched_members])
    user_by_discord_id = {u.discord_id: u for u in users}
    activity_stats = await activity_report_crud.activity_summary_for_user_ids(
        db, [u.id for u in users]
    )
    range_counts = await activity_report_crud.counts_in_range(db, [u.id for u in users], since=since, until=until)

    entries: list[EventRosterEntry] = []
    for member, role in matched_members:
        stats = counts.get(member["discord_id"], {"submitted": 0, "approved": 0, "rejected": 0})
        user = user_by_discord_id.get(member["discord_id"])
        activity = activity_stats.get(user.id, {}) if user else {}
        mini = activity.get("mini", {})
        combat = activity.get("combat", {})
        rp = activity.get("rp", {})
        in_range = range_counts.get(user.id, {}) if user else {}
        entries.append(
            EventRosterEntry(
                discord_id=member["discord_id"],
                username=member["username"],
                avatar_url=member.get("avatar_url"),
                role=role,
                rank=RankRead.model_validate(user.rank) if user and user.rank else None,
                submitted_count=stats["submitted"],
                approved_count=stats["approved"],
                rejected_count=stats["rejected"],
                mini_count_week=mini.get("count_week", 0),
                mini_count_month=mini.get("count_month", 0),
                mini_count_all_time=mini.get("count_all_time", 0),
                combat_count_week=combat.get("count_week", 0),
                combat_count_month=combat.get("count_month", 0),
                combat_count_all_time=combat.get("count_all_time", 0),
                rp_count_week=rp.get("count_week", 0),
                rp_count_month=rp.get("count_month", 0),
                rp_count_all_time=rp.get("count_all_time", 0),
                mini_count=in_range.get("mini", 0),
                combat_count=in_range.get("combat", 0),
                rp_count=in_range.get("rp", 0),
                activity_last_report_at=activity.get("last_report_at"),
            )
        )

    role_order = {"куратор": 0, "ассистент": 1, "старший ивентолог": 2, "ивентолог": 3, "младший ивентолог": 4}
    entries.sort(
        key=lambda e: (role_order.get(e.role, 9), -(e.mini_count + e.combat_count + e.rp_count), e.username)
    )
    return entries


@router.get("/roster/trend", response_model=EventActivityTrendRead)
async def get_roster_trend(
    since: datetime | None = Query(None),
    until: datetime | None = Query(None),
    group: Literal["type", "person"] = Query("type"),
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> EventActivityTrendRead:
    """График активности по дням за период. group=type — линии мини-ивент /
    боевой вылет / РП ивент; group=person — линия на каждого ивентолога, чтобы
    было видно, кто даёт активность (см. решение пользователя). Без since —
    с первого одобренного отчёта («всё время»)."""
    if not access.can_access_event_room:
        raise ForbiddenError("Ивентрум доступен только Ивентологам, Ассистентам и Куратору ивентологии")
    until = _aware(until) or datetime.now(timezone.utc)
    since = _aware(since)
    if since is None:
        first = await activity_report_crud.first_approved_at(db)
        since = _aware(first) if first else until - timedelta(days=29)
    if until <= since:
        raise AppError("Некорректный диапазон дат")

    # Полный список дней диапазона, а не только те, где есть данные — иначе
    # нулевые дни выпадали бы из графика
    dates = []
    cur = since.date()
    while cur <= until.date():
        dates.append(cur.isoformat())
        cur += timedelta(days=1)

    if group == "person":
        by_day = await activity_report_crud.daily_user_counts(db, since=since, until=until)
        totals: dict[int, int] = {}
        for per_user in by_day.values():
            for user_id, count in per_user.items():
                totals[user_id] = totals.get(user_id, 0) + count
        users = {u.id: u for u in await user_crud.get_by_ids(db, list(totals))}
        # самые активные отдельными линиями, остальные — одной общей
        ranked = sorted(totals, key=lambda uid: -totals[uid])
        top, rest = ranked[:7], set(ranked[7:])
        series = [
            EventActivityTrendSeries(
                id=f"user-{uid}",
                label=(users[uid].nickname_override or users[uid].username) if uid in users else f"#{uid}",
                points=[by_day.get(d, {}).get(uid, 0) for d in dates],
            )
            for uid in top
        ]
        if rest:
            series.append(
                EventActivityTrendSeries(
                    id="others",
                    label="Остальные",
                    points=[sum(v for uid, v in by_day.get(d, {}).items() if uid in rest) for d in dates],
                )
            )
        return EventActivityTrendRead(dates=dates, series=series)

    by_day = await activity_report_crud.daily_type_counts(db, since=since, until=until)
    return EventActivityTrendRead(
        dates=dates,
        series=[
            EventActivityTrendSeries(
                id="mini", label="Мини-ивент", points=[by_day.get(d, {}).get("mini", 0) for d in dates]
            ),
            EventActivityTrendSeries(
                id="combat", label="Боевой вылет", points=[by_day.get(d, {}).get("combat", 0) for d in dates]
            ),
            EventActivityTrendSeries(
                id="rp", label="РП ивент", points=[by_day.get(d, {}).get("rp", 0) for d in dates]
            ),
        ],
    )


@router.get("/roster/{discord_id}", response_model=EventMemberDetail)
async def get_roster_member_detail(
    discord_id: str,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> EventMemberDetail:
    """Досье по клику на строку ростера — ранг + список заявок на ивенты и
    отчётов о мероприятиях этого конкретного участника (см. решение
    пользователя: агрегированных счётчиков в таблице недостаточно)."""
    if not access.can_access_event_room:
        raise ForbiddenError("Ивентрум доступен только Ивентологам, Ассистентам и Куратору ивентологии")

    app_config = await app_settings_crud.get(db)
    role_labels = {
        app_config.event_curator_role_id: "куратор",
        app_config.event_assistant_role_id: "ассистент",
        app_config.event_senior_role_id: "старший ивентолог",
        app_config.event_role_id: "ивентолог",
        app_config.event_junior_role_id: "младший ивентолог",
    }
    role_labels.pop(None, None)

    members = await discord_client.fetch_guild_members()
    member = next((m for m in members if m["discord_id"] == discord_id), None)
    if member is None:
        raise NotFoundError("Участник не найден")
    member_role_ids = set(member.get("roles") or [])
    role = next((label for role_id, label in role_labels.items() if role_id in member_role_ids), None)
    if role is None:
        raise NotFoundError("Участник не входит в состав Ивентрума")

    user = await user_crud.get_by_discord_id_with_rank(db, discord_id)
    events: list[EventRead] = []
    activity_reports: list[EventActivityReportRead] = []
    reprimands: list[AdminReprimandRead] = []
    if user is not None:
        events = await _events_to_read(db, await event_crud.list_all(db, submitted_by_user_id=user.id))
        activity_reports = [
            EventActivityReportRead.model_validate(r)
            for r in await activity_report_crud.list_all(db, submitted_by_user_id=user.id)
        ]
        reprimands = [
            AdminReprimandRead.model_validate(r)
            for r in await admin_reprimand_crud.list_for_target(db, target_user_id=user.id)
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

    return EventMemberDetail(
        discord_id=discord_id,
        username=member["username"],
        role=role,
        rank=RankRead.model_validate(user.rank) if user and user.rank else None,
        regiment_id=regiment_id,
        regiment_name=regiment_name,
        events=events,
        activity_reports=activity_reports,
        reprimands=reprimands,
    )


@router.post("/upload-map-image")
async def upload_map_image(
    file: UploadFile = File(...),
    access: AccessContext = Depends(get_access_context),
) -> dict:
    """Своя картинка карты вместо/вместе с названием из каталога (см. решение
    пользователя) — независима от конкретной заявки, ссылка на файл кладётся
    в payload.map_image_url при подаче/правке заявки."""
    if not access.can_access_event_room:
        raise ForbiddenError("Ивентрум доступен только Ивентологам, Ассистентам и Куратору ивентологии")

    content, ext = await read_image_upload(file, allowed_types=_ALLOWED_IMAGE_TYPES, max_size=_MAX_IMAGE_SIZE)

    _UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4()}{ext}"
    (_UPLOAD_ROOT / filename).write_bytes(content)
    return {"url": f"/uploads/events/{filename}"}


@router.post("/preview")
async def preview_event_card(
    payload: EventCreate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> Response:
    """Как будет выглядеть карточка-досье — без сохранения заявки, до отправки
    на одобрение (см. решение пользователя)."""
    if not access.is_event_submitter:
        raise ForbiddenError("Подавать заявки на ивент может только Ивентолог, Ассистент/Куратор ивентологии или создатель")

    image_bytes = await _render_event_image(db, event_id=0, title=payload.title.strip() or "Без названия", payload=payload.payload)
    return StreamingResponse(iter([image_bytes]), media_type="image/png")


@router.get("/{event_id}/card")
async def get_event_card(
    event_id: int,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> Response:
    """Полная карточка-досье уже сохранённой заявки — и для куратора/ассистента
    перед решением по заявке, и чтобы посмотреть, что уже было одобрено и
    отправлено в Discord (см. решение пользователя)."""
    row = await event_crud.get_by_id(db, event_id)
    if row is None:
        raise NotFoundError("Заявка не найдена")
    if not access.can_decide_event and row.submitted_by_user_id != access.user.id:
        raise ForbiddenError("Нет доступа к этой заявке")
    if row.kind != "event":
        raise AppError("Карточка-досье есть только у заявки на ивент")

    image_bytes = await _render_event_image(db, event_id=row.id, title=row.title, payload=row.payload or {})
    return StreamingResponse(iter([image_bytes]), media_type="image/png")


@router.patch("/{event_id}", response_model=EventRead)
async def update_event(
    event_id: int,
    payload: EventUpdate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> EventRead:
    """Кто может править (см. решение пользователя): Ассистент/Куратор — когда
    угодно, кроме уже отменённой заявки; автор — только пока заявка на
    рассмотрении или возвращена на редакцию. Правка автором заявки «на
    редакции» снова отправляет её на рассмотрение. Если сообщение уже ушло в
    Discord, правка редактирует то же сообщение."""
    row = await event_crud.get_by_id(db, event_id)
    if row is None:
        raise NotFoundError("Заявка не найдена")
    if row.status == "cancelled":
        raise ForbiddenError("Отменённую заявку менять нельзя")
    is_author = row.submitted_by_user_id == access.user.id
    if not access.can_decide_event:
        if not is_author:
            raise ForbiddenError("Редактировать заявку может только её автор или Ассистент/Куратор ивентологии")
        if row.status not in ("pending", "revision"):
            raise ForbiddenError("Заявка уже рассмотрена — правки теперь вносит Ассистент/Куратор ивентологии")

    resubmit = is_author and row.status == "revision"
    updated = await event_crud.update_content(
        db, row, title=payload.title.strip(), payload=payload.payload, resubmit=resubmit
    )
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="event_update",
        details=f"Изменил заявку «{updated.title}» (#{updated.id})" + (" и вернул на рассмотрение" if resubmit else ""),
        target_user_id=updated.submitted_by_user_id,
    )

    if updated.notified_at and updated.discord_message_id:
        try:
            await _deliver(db, updated, new=False)
        except Exception:
            # правка в БД уже сохранена — сбой Discord её не откатывает
            logger.exception("Не удалось обновить сообщение заявки «%s» в Discord", updated.title)

    event_bus.publish("event_room")
    return await _event_to_read(db, updated)


def _ping_content(app_config) -> str | None:
    """Текст сообщения с упоминанием настроенной роли (см. решение
    пользователя — при одобрении бот пингует роль, помимо карточки-досье).
    Упоминания ролей работают только в content, не в embed."""
    if app_config.event_notify_ping_role_id:
        return f"<@&{app_config.event_notify_ping_role_id}>"
    return None


def _format_datetime(value: str | None) -> str | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return value
    return dt.strftime("%d.%m.%Y, %H:%M")


def _format_audience(value: dict | None, regiments_by_id: dict, *, plain: bool, members_by_id: dict) -> str | None:
    """Участники/приписной состав — либо роль формирования, либо список людей
    (см. решение пользователя про поля формы ивента). plain=True — для
    картинки-досье (там нет живых Discord-упоминаний, нужны обычные имена).
    custom_name — нишевое формирование, которого нет в каталоге CRM, вписанное
    вручную (см. решение пользователя)."""
    if not value:
        return None
    mode = value.get("mode")
    if mode == "role":
        custom_name = (value.get("custom_name") or "").strip()
        if custom_name:
            return custom_name
        regiment_id = value.get("regiment_id")
        regiment = regiments_by_id.get(regiment_id)
        return regiment.name if regiment else None
    if mode == "people":
        discord_ids = value.get("discord_ids") or []
        if not discord_ids:
            return None
        if plain:
            return ", ".join(members_by_id.get(discord_id, discord_id) for discord_id in discord_ids)
        return ", ".join(f"<@{discord_id}>" for discord_id in discord_ids)
    return None


async def _get_selected_map(db: AsyncSession, row):
    map_id = (row.payload or {}).get("map_id")
    if not map_id:
        return None
    return await event_crud.get_map_by_id(db, map_id)


def _build_event_embed(row, map_row) -> dict:
    """Метаданные операции — живые Discord-поля (упоминания, дата, планета)
    сверху сообщения; содержательная часть (сводка/цель/задача/состав/угроза)
    — в приложенной картинке-досье, см. render_operation_dossier. Планета —
    поля самой заявки (row.payload), не карты (см. решение пользователя:
    планета привязана к конкретному ивенту, а не к переиспользуемой карте) —
    раньше шла отдельным текстом в content, теперь встроена в embed как
    обычные структурные поля."""
    payload = row.payload or {}

    fields = []

    def add_field(name: str, value, inline: bool = True):
        if value in (None, ""):
            return
        fields.append({"name": name, "value": str(value), "inline": inline})

    add_field("🕐 Начало брифинга", _format_datetime(payload.get("briefing_start")))
    add_field("👤 Проводящий", f"<@{row.submitted_by.discord_id}>")
    commander_id = payload.get("commander_discord_id")
    add_field("⭐ Командующий", f"<@{commander_id}>" if commander_id else _COMMANDER_TBD)

    map_value = None
    if map_row is not None:
        map_value = f"[{map_row.name}]({map_row.url})" if map_row.url else map_row.name
    add_field("🗺️ Карта", map_value)

    add_field("🪐 Планета", payload.get("planet_name"))
    add_field("Система", payload.get("star_system"))
    add_field("Ландшафт", payload.get("landscape"))
    add_field("Погодные условия", payload.get("weather"))
    add_field("Флора и фауна", payload.get("flora_fauna"), inline=False)

    return {
        "title": row.title,
        "color": 0x3B6FD6,
        "fields": fields,
        "footer": {"text": f"COLLAPSAR · Ивентрум · Заявка #{row.id}"},
    }


def _message_content(app_config) -> str | None:
    return _ping_content(app_config)


def _read_map_image(payload: dict) -> bytes | None:
    url = payload.get("map_image_url")
    if not url:
        return None
    path = _UPLOAD_ROOT / Path(url).name
    try:
        return path.read_bytes()
    except OSError:
        return None


async def _render_event_image(db: AsyncSession, *, event_id: int, title: str, payload: dict) -> bytes:
    regiments = await regiment_crud.get_all(db)
    regiments_by_id = {r.id: r for r in regiments}
    members = await discord_client.fetch_guild_members()
    members_by_id = {m["discord_id"]: m["username"] for m in members}

    participants_label = _format_audience(
        payload.get("participants"), regiments_by_id, plain=True, members_by_id=members_by_id
    )
    attached_label = _format_audience(
        payload.get("attached"), regiments_by_id, plain=True, members_by_id=members_by_id
    )
    if attached_label:
        participants_label = f"{participants_label} + {attached_label}" if participants_label else attached_label

    map_name = None
    map_id = payload.get("map_id")
    if map_id:
        map_row = await event_crud.get_map_by_id(db, map_id)
        map_name = map_row.name if map_row else None

    return render_operation_dossier(
        event_id=event_id,
        title=title,
        summary=payload.get("summary"),
        objective=payload.get("objective"),
        tasks=payload.get("tasks"),
        extra_tasks=payload.get("extra_tasks"),
        threat=payload.get("threat"),
        participants_label=participants_label,
        map_name=map_name,
        map_image=_read_map_image(payload),
    )


@router.post("/{event_id}/approve", response_model=EventRead)
async def approve_event(
    event_id: int,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> EventRead:
    """Одобрение больше не отправляет сообщение само: после него у автора
    появляется кнопка «Отправить» (см. send_event), см. решение пользователя."""
    if not access.can_decide_event:
        raise ForbiddenError("Одобрить заявку может только Ассистент/Куратор ивентологии")

    row = await event_crud.get_by_id(db, event_id)
    if row is None:
        raise NotFoundError("Заявка не найдена")

    updated = await event_crud.decide(db, row, approve=True, decided_by_user_id=access.user.id)
    kind_label = KIND_LABELS.get(updated.kind, "Заявка")
    logger.info("%s одобрил заявку «%s»", access.user.username, updated.title)
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="event_approve",
        details=f"Одобрил «{kind_label}» «{updated.title}» (#{updated.id})",
        target_user_id=updated.submitted_by_user_id,
    )
    await notification_crud.create_personal_notification(
        db,
        target_user_id=updated.submitted_by_user_id,
        title=f"{kind_label}: одобрено",
        body=f"«{updated.title}» одобрена. Отправьте её в Discord кнопкой «Отправить» в Ивентруме.",
        created_by=access.user.id,
    )
    event_bus.publish("event_room")
    return await _event_to_read(db, updated)


@router.post("/{event_id}/reject", response_model=EventRead)
async def reject_event(
    event_id: int,
    payload: EventRejectRequest,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> EventRead:
    if not access.can_decide_event:
        raise ForbiddenError("Отклонить ивент может только Ассистент/Куратор ивентологии")

    row = await event_crud.get_by_id(db, event_id)
    if row is None:
        raise NotFoundError("Заявка не найдена")

    updated = await event_crud.decide(
        db, row, approve=False, decided_by_user_id=access.user.id, rejection_reason=payload.reason.strip()
    )
    logger.info("%s отклонил ивент «%s»", access.user.username, updated.title)
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="event_reject",
        details=f"Отклонил заявку на ивент «{updated.title}» (#{updated.id}): {payload.reason.strip()}",
        target_user_id=updated.submitted_by_user_id,
    )
    event_bus.publish("event_room")
    return await _event_to_read(db, updated)


@router.post("/{event_id}/revision", response_model=EventRead)
async def send_event_to_revision(
    event_id: int,
    payload: EventRevisionRequest,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> EventRead:
    """Вернуть заявку автору с коротким замечанием, что поправить."""
    if not access.can_decide_event:
        raise ForbiddenError("Вернуть заявку на редакцию может только Ассистент/Куратор ивентологии")
    row = await event_crud.get_by_id(db, event_id)
    if row is None:
        raise NotFoundError("Заявка не найдена")
    comment = payload.comment.strip()
    updated = await event_crud.send_to_revision(db, row, reviewer_user_id=access.user.id, comment=comment)
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="event_revision",
        details=f"Вернул на редакцию «{updated.title}» (#{updated.id}): {comment}",
        target_user_id=updated.submitted_by_user_id,
    )
    await notification_crud.create_personal_notification(
        db,
        target_user_id=updated.submitted_by_user_id,
        title=f"{KIND_LABELS.get(updated.kind, 'Заявка')}: нужна правка",
        body=f"«{updated.title}»: {comment}",
        created_by=access.user.id,
    )
    event_bus.publish("event_room")
    return await _event_to_read(db, updated)


@router.post("/{event_id}/send", response_model=EventRead)
async def send_event(
    event_id: int,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> EventRead:
    """Отправить одобренную заявку в Discord — автор или Ассистент/Куратор.
    Повторно отправить нельзя: дальше правки редактируют то же сообщение."""
    row = await event_crud.get_by_id(db, event_id)
    if row is None:
        raise NotFoundError("Заявка не найдена")
    if row.submitted_by_user_id != access.user.id and not access.can_decide_event:
        raise ForbiddenError("Отправить может автор заявки или Ассистент/Куратор ивентологии")
    if row.status != "approved":
        raise AppError("Отправить можно только одобренную заявку")
    if row.notified_at:
        raise AppError("Заявка уже отправлена")

    channel, message_id = await _deliver(db, row, new=True)
    updated = await event_crud.mark_sent(
        db, row, sent_by_user_id=access.user.id, channel_id=channel, discord_message_id=message_id
    )
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="event_send",
        details=f"Отправил в Discord «{updated.title}» (#{updated.id})",
        target_user_id=updated.submitted_by_user_id,
    )
    event_bus.publish("event_room")
    return await _event_to_read(db, updated)


@router.post("/{event_id}/cancel", response_model=EventRead)
async def cancel_event(
    event_id: int,
    payload: EventCancelRequest,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> EventRead:
    """Отмена уже одобренной заявки (см. решение пользователя) — редактирует
    уже отправленную карточку в Discord, помечая её отменённой, вместо того
    чтобы удалять сообщение или менять статус на "отклонено" (это разные вещи:
    отклонили изначально или одобрили, а потом отменили)."""
    if not access.can_decide_event:
        raise ForbiddenError("Отменить одобренную заявку может только Ассистент/Куратор ивентологии")

    row = await event_crud.get_by_id(db, event_id)
    if row is None:
        raise NotFoundError("Заявка не найдена")

    reason = (payload.reason or "").strip() or None
    updated = await event_crud.cancel(db, row, cancelled_by_user_id=access.user.id, reason=reason)
    logger.info("%s отменил одобренный ивент «%s»", access.user.username, updated.title)
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="event_cancel",
        details=f"Отменил одобренную заявку на ивент «{updated.title}» (#{updated.id})"
        + (f": {reason}" if reason else ""),
        target_user_id=updated.submitted_by_user_id,
    )

    if updated.notified_at and updated.discord_message_id:
        try:
            await _deliver(db, updated, new=False, cancelled=True)
        except Exception:
            # отмена в БД уже сохранена — сбой правки сообщения в Discord не
            # должен откатывать решение
            logger.exception("Не удалось отметить заявку «%s» как отменённую в Discord", updated.title)

    event_bus.publish("event_room")
    return await _event_to_read(db, updated)


@router.post("/{event_id}/messages", response_model=EventMessageRead, status_code=201)
async def create_event_message(
    event_id: int,
    payload: EventMessageCreate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> EventMessageRead:
    """Заявка на свободное сообщение по одобренной заявке — не отправляется
    сразу, а идёт на решение Ассистенту+/Куратору (см. решение пользователя),
    как и сама заявка на ивент. Подать может только автор заявки."""
    row = await event_crud.get_by_id(db, event_id)
    if row is None:
        raise NotFoundError("Заявка не найдена")
    if row.submitted_by_user_id != access.user.id:
        raise ForbiddenError("Подать заявку на сообщение может только автор заявки на ивент")
    if row.status != "approved":
        raise AppError("Заявка ещё не одобрена")

    message = await event_message_crud.create(
        db, event_id=event_id, content=payload.content.strip(), submitted_by_user_id=access.user.id
    )
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="event_message_create",
        details=f"Подал заявку на сообщение по заявке «{row.title}» (#{row.id})",
    )
    event_bus.publish("event_room")
    return EventMessageRead.model_validate(message)


@router.patch("/messages/{message_id}", response_model=EventMessageRead)
async def decide_event_message(
    message_id: int,
    payload: EventMessageDecide,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> EventMessageRead:
    if not access.can_decide_event:
        raise ForbiddenError("Решить по заявке на сообщение может только Ассистент/Куратор ивентологии")
    message = await event_message_crud.get_by_id(db, message_id)
    if message is None:
        raise NotFoundError("Заявка на сообщение не найдена")

    updated = await event_message_crud.decide(
        db,
        message,
        approve=payload.status == "approved",
        decided_by_user_id=access.user.id,
        rejection_reason=payload.rejection_reason,
    )
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="event_message_decide",
        details=f"Заявка на сообщение {message_id} (событие #{updated.event_id}) -> {payload.status}",
    )
    if updated.status == "approved":
        await notification_crud.create_personal_notification(
            db,
            target_user_id=updated.submitted_by_user_id,
            title="Заявка на сообщение одобрена",
            body="Ваше сообщение по ивенту одобрено — теперь его можно отправить.",
            created_by=access.user.id,
        )
    event_bus.publish("event_room")
    return EventMessageRead.model_validate(updated)


@router.post("/messages/{message_id}/send", response_model=EventMessageRead)
async def send_event_message(
    message_id: int,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> EventMessageRead:
    """Реальная отправка в Discord — доступна и автору заявки на сообщение, и
    Ассистенту+/Куратору (см. решение пользователя), но только после
    одобрения; повторно отправить нельзя. Статус/sent_at проверяются ЗДЕСЬ,
    до вызова Discord — если положиться только на guard внутри mark_sent
    (который срабатывает ПОСЛЕ фактической отправки), то по клику на уже
    отправленное или ещё не одобренное сообщение бот всё равно шлёт реальное
    сообщение в канал, а уже потом падает с ошибкой (баг-репорт при
    разработке — 3 реальных отправки на 1 успешный сценарий в тесте)."""
    message = await event_message_crud.get_by_id(db, message_id)
    if message is None:
        raise NotFoundError("Заявка на сообщение не найдена")
    if message.submitted_by_user_id != access.user.id and not access.can_decide_event:
        raise ForbiddenError("Отправить сообщение может автор заявки или Ассистент/Куратор ивентологии")
    if message.status != "approved":
        raise AppError("Отправить можно только одобренное сообщение")
    if message.sent_at is not None:
        raise AppError("Сообщение уже отправлено")

    app_config = await app_settings_crud.get(db)
    if not app_config.event_notify_channel_id:
        raise AppError("Канал уведомлений Ивентрума не настроен")

    await discord_client.send_channel_message(
        app_config.event_notify_channel_id,
        content=f"💬 {message.submitted_by.username}: {message.content}",
    )
    updated = await event_message_crud.mark_sent(db, message, sent_by_user_id=access.user.id)
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="event_message_send",
        details=f"Отправил сообщение {message_id} по ивенту #{updated.event_id}",
    )
    event_bus.publish("event_room")
    return EventMessageRead.model_validate(updated)


# --- Каталог карт (правят только Ассистент/Куратор ивентологии) -------------


@router.get("/maps/all", response_model=list[EventMapRead])
async def list_maps(
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[EventMapRead]:
    if not access.can_access_event_room:
        raise ForbiddenError("Ивентрум доступен только Ивентологам, Ассистентам и Куратору ивентологии")
    rows = await event_crud.list_maps(db)
    return [EventMapRead.model_validate(r) for r in rows]


@router.post("/maps", response_model=EventMapRead, status_code=201)
async def create_map(
    payload: EventMapCreate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> EventMapRead:
    if not access.can_decide_event:
        raise ForbiddenError("Список карт правят только Ассистент/Куратор ивентологии")
    row = await event_crud.create_map(
        db,
        name=payload.name.strip(),
        url=(payload.url or "").strip() or None,
    )
    return EventMapRead.model_validate(row)


@router.patch("/maps/{map_id}", response_model=EventMapRead)
async def update_map(
    map_id: int,
    payload: EventMapUpdate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> EventMapRead:
    if not access.can_decide_event:
        raise ForbiddenError("Список карт правят только Ассистент/Куратор ивентологии")
    row = await event_crud.get_map_by_id(db, map_id)
    if row is None:
        raise NotFoundError("Карта не найдена")
    changes = payload.model_dump(exclude_unset=True)
    for key in ("name", "url"):
        if key in changes and isinstance(changes[key], str):
            changes[key] = changes[key].strip() or None
    updated = await event_crud.update_map(db, row, **changes)
    return EventMapRead.model_validate(updated)


@router.delete("/maps/{map_id}", status_code=204)
async def delete_map(
    map_id: int,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> None:
    if not access.can_decide_event:
        raise ForbiddenError("Список карт правят только Ассистент/Куратор ивентологии")
    row = await event_crud.get_map_by_id(db, map_id)
    if row is None:
        raise NotFoundError("Карта не найдена")
    await event_crud.delete_map(db, row)
