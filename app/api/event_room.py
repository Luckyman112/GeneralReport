"""Ивентрум — заявки на ивенты от Ивентологов, одобряет Ассистент/Куратор
ивентологии; при одобрении бот отправляет карточку операции в настроенный
Discord-канал (см. app/core/discord_client.py::send_channel_message).
Отдельная от Report сущность/UI — набор полей задаётся на фронте, не
конструктором в БД (см. Event.payload), см. решение пользователя."""
import logging
import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, Response, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AccessContext, get_access_context
from app.core import discord_client
from app.core.event_card import render_operation_dossier
from app.core.events import event_bus
from app.core.uploads import read_image_upload
from app.crud import app_settings as app_settings_crud
from app.crud import audit_log as audit_log_crud
from app.crud import event as event_crud
from app.crud import regiment as regiment_crud
from app.database import get_db
from app.exceptions import AppError, ForbiddenError, NotFoundError
from app.schemas.event import (
    EventCreate,
    EventMapCreate,
    EventMapRead,
    EventMapUpdate,
    EventRead,
    EventRejectRequest,
    EventRosterEntry,
    EventUpdate,
)
from app.schemas.regiment_commander import GuildMemberRead

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/event-room", tags=["event-room"])

# "летят те, кем командует тот" — командующего часто узнают только по ходу
# брифинга, не до подачи заявки (см. решение пользователя)
_COMMANDER_TBD = "Определится на брифинге"

_UPLOAD_ROOT = Path(__file__).resolve().parent.parent.parent / "uploads" / "events"
_ALLOWED_IMAGE_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}
_MAX_IMAGE_SIZE = 5 * 1024 * 1024  # 5 МБ, как у картинок рапортов


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
    return [EventRead.model_validate(r) for r in rows]


@router.post("", response_model=EventRead, status_code=201)
async def create_event(
    payload: EventCreate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> EventRead:
    if not access.is_event_submitter:
        raise ForbiddenError("Подавать заявки на ивент может только Ивентолог, Ассистент/Куратор ивентологии или создатель")

    row = await event_crud.create(
        db, title=payload.title.strip(), payload=payload.payload, submitted_by_user_id=access.user.id
    )
    logger.info("%s подал заявку на ивент «%s»", access.user.username, row.title)
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="event_create",
        details=f"Подал заявку на ивент «{row.title}» (#{row.id})",
    )
    event_bus.publish("event_room")
    return EventRead.model_validate(row)


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


@router.get("/roster", response_model=list[EventRosterEntry])
async def get_roster(
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[EventRosterEntry]:
    """Состав Ивентрума (Ивентолог/Ассистент/Куратор) с их статистикой по
    заявкам — сколько подал/одобрено/отклонено (см. решение пользователя)."""
    if not access.can_access_event_room:
        raise ForbiddenError("Ивентрум доступен только Ивентологам, Ассистентам и Куратору ивентологии")

    app_config = await app_settings_crud.get(db)
    role_labels = {
        app_config.event_curator_role_id: "куратор",
        app_config.event_assistant_role_id: "ассистент",
        app_config.event_role_id: "ивентолог",
    }
    role_labels.pop(None, None)
    if not role_labels:
        return []

    members = await discord_client.fetch_guild_members()
    all_events = await event_crud.list_all(db)
    counts: dict[str, dict[str, int]] = {}
    for ev in all_events:
        discord_id = ev.submitted_by.discord_id
        bucket = counts.setdefault(discord_id, {"submitted": 0, "approved": 0, "rejected": 0})
        bucket["submitted"] += 1
        if ev.status == "approved":
            bucket["approved"] += 1
        elif ev.status == "rejected":
            bucket["rejected"] += 1

    entries: list[EventRosterEntry] = []
    for member in members:
        member_role_ids = set(member.get("roles") or [])
        # куратор > ассистент > ивентолог — если роли совмещены, показываем старшую
        role = next((label for role_id, label in role_labels.items() if role_id in member_role_ids), None)
        if role is None:
            continue
        stats = counts.get(member["discord_id"], {"submitted": 0, "approved": 0, "rejected": 0})
        entries.append(
            EventRosterEntry(
                discord_id=member["discord_id"],
                username=member["username"],
                avatar_url=member.get("avatar_url"),
                role=role,
                submitted_count=stats["submitted"],
                approved_count=stats["approved"],
                rejected_count=stats["rejected"],
            )
        )

    role_order = {"куратор": 0, "ассистент": 1, "ивентолог": 2}
    entries.sort(key=lambda e: (role_order.get(e.role, 9), -e.submitted_count, e.username))
    return entries


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

    image_bytes = await _render_event_image(db, event_id=row.id, title=row.title, payload=row.payload or {})
    return StreamingResponse(iter([image_bytes]), media_type="image/png")


@router.patch("/{event_id}", response_model=EventRead)
async def update_event(
    event_id: int,
    payload: EventUpdate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> EventRead:
    """Правка заявки — доступна и пока она ожидает решения, и уже после
    одобрения (многое, например командующего операции, узнают только по мере
    брифинга — см. решение пользователя). Отклонённую заявку менять нельзя —
    решение по ней уже окончательно. Если заявка уже была одобрена, дозаполнение
    РЕДАКТИРУЕТ уже отправленное ботом сообщение (см. решение пользователя) —
    если его почему-то не удалось отредактировать (например, кто-то удалил
    сообщение вручную), бот отправляет новое и запоминает уже его id."""
    row = await event_crud.get_by_id(db, event_id)
    if row is None:
        raise NotFoundError("Заявка не найдена")
    if row.status == "rejected":
        raise ForbiddenError("Отклонённую заявку менять нельзя")
    if row.submitted_by_user_id != access.user.id and not access.can_decide_event:
        raise ForbiddenError("Редактировать заявку может только её автор или Ассистент/Куратор ивентологии")

    was_approved = row.status == "approved"
    updated = await event_crud.update_content(db, row, title=payload.title.strip(), payload=payload.payload)
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="event_update",
        details=f"Дозаполнил заявку на ивент «{updated.title}» (#{updated.id})",
        target_user_id=updated.submitted_by_user_id,
    )

    if was_approved:
        app_config = await app_settings_crud.get(db)
        if app_config.event_notify_channel_id:
            try:
                map_row = await _get_selected_map(db, updated)
                embed = _build_event_embed(updated, map_row)
                image_bytes = await _render_event_image(
                    db, event_id=updated.id, title=updated.title, payload=updated.payload or {}
                )
                content = _message_content(app_config, map_row)
                if updated.discord_message_id:
                    try:
                        await discord_client.edit_channel_message(
                            app_config.event_notify_channel_id,
                            updated.discord_message_id,
                            embed=embed,
                            file_bytes=image_bytes,
                            filename=f"operation-{updated.id}.png",
                            content=content,
                        )
                    except Exception:
                        # сообщение могли удалить руками в Discord — не роняем
                        # дозаполнение, просто заводим сообщение заново
                        logger.exception(
                            "Не удалось отредактировать сообщение ивента «%s», отправляю новое", updated.title
                        )
                        message_id = await discord_client.send_channel_message_with_file(
                            app_config.event_notify_channel_id,
                            embed=embed,
                            file_bytes=image_bytes,
                            filename=f"operation-{updated.id}.png",
                            content=content,
                        )
                        await event_crud.mark_notified(db, updated, discord_message_id=message_id)
                else:
                    # одобрили ещё до этой возможности — id сообщения не сохранён
                    message_id = await discord_client.send_channel_message_with_file(
                        app_config.event_notify_channel_id,
                        embed=embed,
                        file_bytes=image_bytes,
                        filename=f"operation-{updated.id}.png",
                        content=content,
                    )
                    await event_crud.mark_notified(db, updated, discord_message_id=message_id)
            except Exception:
                logger.exception("Не удалось отправить обновление ивента «%s» в Discord", updated.title)

    event_bus.publish("event_room")
    return EventRead.model_validate(updated)


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
    """Метаданные операции — живые Discord-поля (упоминания, дата) сверху
    сообщения; содержательная часть (сводка/цель/задача/состав/угроза) —
    в приложенной картинке-досье, см. render_operation_dossier. Справка о
    планете сюда НЕ входит — идёт отдельным текстом в content, см.
    _planet_info_text (решение пользователя)."""
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

    return {
        "title": row.title,
        "color": 0x3B6FD6,
        "fields": fields,
        "footer": {"text": f"COLLAPSAR · Ивентрум · Заявка #{row.id}"},
    }


def _planet_info_text(map_row) -> str | None:
    """Справочная информация о планете карты — не для карточки, отдельным
    текстом в теле сообщения (см. решение пользователя)."""
    if map_row is None:
        return None
    lines = []
    if map_row.planet_name:
        lines.append(f"🪐 Планета: {map_row.planet_name}")
    if map_row.star_system:
        lines.append(f"Система: {map_row.star_system}")
    if map_row.landscape:
        lines.append(f"Ландшафт: {map_row.landscape}")
    if map_row.weather:
        lines.append(f"Погодные условия: {map_row.weather}")
    return "\n".join(lines) if lines else None


def _message_content(app_config, map_row) -> str | None:
    parts = [p for p in (_ping_content(app_config), _planet_info_text(map_row)) if p]
    return "\n\n".join(parts) if parts else None


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
    if not access.can_decide_event:
        raise ForbiddenError("Одобрить ивент может только Ассистент/Куратор ивентологии")

    row = await event_crud.get_by_id(db, event_id)
    if row is None:
        raise NotFoundError("Заявка не найдена")

    updated = await event_crud.decide(db, row, approve=True, decided_by_user_id=access.user.id)
    logger.info("%s одобрил ивент «%s»", access.user.username, updated.title)
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="event_approve",
        details=f"Одобрил заявку на ивент «{updated.title}» (#{updated.id})",
        target_user_id=updated.submitted_by_user_id,
    )

    app_config = await app_settings_crud.get(db)
    if app_config.event_notify_channel_id:
        try:
            map_row = await _get_selected_map(db, updated)
            embed = _build_event_embed(updated, map_row)
            image_bytes = await _render_event_image(
                db, event_id=updated.id, title=updated.title, payload=updated.payload or {}
            )
            message_id = await discord_client.send_channel_message_with_file(
                app_config.event_notify_channel_id,
                embed=embed,
                file_bytes=image_bytes,
                filename=f"operation-{updated.id}.png",
                content=_message_content(app_config, map_row),
            )
            await event_crud.mark_notified(db, updated, discord_message_id=message_id)
        except Exception:
            # одобрение уже сохранено — сбой отправки в Discord не должен
            # откатывать решение, просто notified_at останется пустым
            logger.exception("Не удалось отправить уведомление об ивенте «%s» в Discord", updated.title)

    event_bus.publish("event_room")
    return EventRead.model_validate(updated)


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
    return EventRead.model_validate(updated)


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
        planet_name=(payload.planet_name or "").strip() or None,
        landscape=(payload.landscape or "").strip() or None,
        weather=(payload.weather or "").strip() or None,
        star_system=(payload.star_system or "").strip() or None,
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
    for key in ("name", "url", "planet_name", "landscape", "weather", "star_system"):
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
