"""Колокольчик уведомлений: объявления администрации (видны всем) + уведомления о
новых нарушениях бойцов своего формирования (видны командиру/заместителю). Прочитанным
считается всё сразу при открытии колокольчика, а не по каждому сообщению отдельно."""
import logging

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AccessContext, get_access_context
from app.crud import audit_log as audit_log_crud
from app.crud import notification as notification_crud
from app.database import get_db
from app.exceptions import ForbiddenError, NotFoundError
from app.schemas.notification import BroadcastCreate, NotificationRead

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=list[NotificationRead])
async def list_notifications(
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> list[NotificationRead]:
    notifications = await notification_crud.list_for_user(
        db,
        user_id=access.user.id,
        commander_regiment_ids=access.commander_regiment_ids,
        see_all=access.is_admin or access.is_high_command,
    )
    read_ids = await notification_crud.get_read_ids(
        db, user_id=access.user.id, notification_ids=[n.id for n in notifications]
    )
    return [
        NotificationRead(
            id=n.id,
            kind=n.kind,
            title=n.title,
            body=n.body,
            regiment_id=n.regiment_id,
            violation_id=n.violation_id,
            created_at=n.created_at,
            is_read=n.id in read_ids,
        )
        for n in notifications
    ]


@router.post("/read-all", status_code=204)
async def mark_all_read(
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> None:
    notifications = await notification_crud.list_for_user(
        db,
        user_id=access.user.id,
        commander_regiment_ids=access.commander_regiment_ids,
        see_all=access.is_admin or access.is_high_command,
    )
    await notification_crud.mark_all_read(
        db, user_id=access.user.id, notification_ids=[n.id for n in notifications]
    )


@router.post("/broadcast", response_model=NotificationRead, status_code=201)
async def create_broadcast(
    payload: BroadcastCreate,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> NotificationRead:
    if not access.can_send_broadcast:
        raise ForbiddenError("У вас нет прав на отправку объявлений")
    notification = await notification_crud.create_broadcast(
        db, title=payload.title, body=payload.body, created_by=access.user.id
    )
    logger.info("%s отправил объявление '%s'", access.user.username, payload.title)
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="broadcast_create",
        details=f"Отправил объявление «{payload.title}»: {payload.body}",
    )
    return NotificationRead(
        id=notification.id,
        kind=notification.kind,
        title=notification.title,
        body=notification.body,
        regiment_id=notification.regiment_id,
        violation_id=notification.violation_id,
        created_at=notification.created_at,
        is_read=False,
    )


@router.delete("/{notification_id}", status_code=204)
async def delete_notification(
    notification_id: int,
    db: AsyncSession = Depends(get_db),
    access: AccessContext = Depends(get_access_context),
) -> None:
    """Удалить общее объявление (kind="broadcast") — тем же правом, что и на
    отправку. Автосозданные уведомления о нарушениях/личные решения так не
    удаляются — это часть истории, а не сообщение, которое можно отозвать."""
    if not access.can_send_broadcast:
        raise ForbiddenError("У вас нет прав на удаление объявлений")

    notification = await notification_crud.get_by_id(db, notification_id)
    if notification is None:
        raise NotFoundError("Объявление не найдено")
    if notification.kind != "broadcast":
        raise ForbiddenError("Удалить так можно только общее объявление")

    await notification_crud.delete(db, notification)
    logger.info("%s удалил объявление '%s'", access.user.username, notification.title)
    await audit_log_crud.log(
        db,
        actor_user_id=access.user.id,
        actor_is_admin=access.is_admin,
        action="broadcast_delete",
        details=f"Удалил объявление «{notification.title}»",
    )
