"""Ивентрум — заявки на ивенты от Ивентологов, одобряет Ассистент/Куратор
ивентологии; при одобрении бот отправляет карточку операции в настроенный
Discord-канал (см. app/core/discord_client.py::send_channel_message).
Отдельная от Report сущность/UI — набор полей задаётся на фронте, не
конструктором в БД (см. Event.payload), см. решение пользователя."""
import logging
from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AccessContext, get_access_context
from app.core import discord_client
from app.core.event_card import render_operation_dossier
from app.core.events import event_bus
from app.crud import app_settings as app_settings_crud
from app.crud import event as event_crud
from app.crud import regiment as regiment_crud
from app.database import get_db
from app.exceptions import ForbiddenError, NotFoundError
from app.schemas.event import EventCreate, EventMapCreate, EventMapRead, EventRead, EventRejectRequest, EventUpdate
from app.schemas.regiment_commander import GuildMemberRead

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/event-room", tags=["event-room"])


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


@router.get("/{event_id}", response_model=EventRead)
async def get_event(
    event_id: int,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> EventRead:
    row = await event_crud.get_by_id(db, event_id)
    if row is None:
        raise NotFoundError("Заявка не найдена")
    if not access.can_decide_event and row.submitted_by_user_id != access.user.id:
        raise ForbiddenError("Нет доступа к этой заявке")
    return EventRead.model_validate(row)


@router.patch("/{event_id}", response_model=EventRead)
async def update_event(
    event_id: int,
    payload: EventUpdate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> EventRead:
    """Правка, пока заявка pending — многое (например, командующего операции)
    узнают только по мере брифинга, уже после подачи заявки (см. решение
    пользователя)."""
    row = await event_crud.get_by_id(db, event_id)
    if row is None:
        raise NotFoundError("Заявка не найдена")
    if row.status != "pending":
        raise ForbiddenError("Менять можно только заявку, ожидающую решения")
    if row.submitted_by_user_id != access.user.id and not access.can_decide_event:
        raise ForbiddenError("Редактировать заявку может только её автор или Ассистент/Куратор ивентологии")

    updated = await event_crud.update_pending(db, row, title=payload.title.strip(), payload=payload.payload)
    event_bus.publish("event_room")
    return EventRead.model_validate(updated)


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
    картинки-досье (там нет живых Discord-упоминаний, нужны обычные имена)."""
    if not value:
        return None
    mode = value.get("mode")
    if mode == "role":
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


async def _build_event_embed(db: AsyncSession, row) -> dict:
    """Метаданные операции — живые Discord-поля (упоминания, дата) сверху
    сообщения; содержательная часть (сводка/цель/задача/состав/угроза) —
    в приложенной картинке-досье, см. render_operation_dossier."""
    payload = row.payload or {}

    fields = []

    def add_field(name: str, value, inline: bool = True):
        if value in (None, ""):
            return
        fields.append({"name": name, "value": str(value), "inline": inline})

    add_field("🕐 Начало брифинга", _format_datetime(payload.get("briefing_start")))
    add_field("👤 Проводящий", f"<@{row.submitted_by.discord_id}>")
    if payload.get("commander_discord_id"):
        add_field("⭐ Командующий", f"<@{payload['commander_discord_id']}>")

    map_name = None
    map_id = payload.get("map_id")
    if map_id:
        map_row = await event_crud.get_map_by_id(db, map_id)
        map_name = map_row.name if map_row else None
    add_field("🗺️ Карта", map_name)

    return {
        "title": row.title,
        "color": 0x3B6FD6,
        "fields": fields,
        "footer": {"text": f"COLLAPSAR · Ивентрум · Заявка #{row.id}"},
    }


async def _render_event_image(db: AsyncSession, row) -> bytes:
    payload = row.payload or {}
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
        event_id=row.id,
        title=row.title,
        summary=payload.get("summary"),
        objective=payload.get("objective"),
        task=payload.get("task"),
        threat=payload.get("threat"),
        participants_label=participants_label,
        map_name=map_name,
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

    app_config = await app_settings_crud.get(db)
    if app_config.event_notify_channel_id:
        try:
            embed = await _build_event_embed(db, updated)
            image_bytes = await _render_event_image(db, updated)
            await discord_client.send_channel_message_with_file(
                app_config.event_notify_channel_id,
                embed=embed,
                file_bytes=image_bytes,
                filename=f"operation-{updated.id}.png",
            )
            await event_crud.mark_notified(db, updated)
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
    row = await event_crud.create_map(db, name=payload.name.strip())
    return EventMapRead.model_validate(row)


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
