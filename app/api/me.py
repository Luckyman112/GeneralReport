"""Информация о текущем пользователе и его уровне доступа — нужна фронтенду для UI."""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AccessContext, get_access_context
from app.core import discord_client
from app.crud import character as character_crud
from app.crud import regiment as regiment_crud
from app.crud import transfer_request as transfer_request_crud
from app.database import get_db
from app.exceptions import ForbiddenError
from app.schemas.character import CharacterRead
from app.schemas.me import AccessInfo, MeResponse
from app.schemas.regiment_commander import GuildMemberRead
from app.schemas.transfer_request import TransferRequestRead
from app.schemas.user import UserRead

router = APIRouter(tags=["me"])


@router.get("/me", response_model=MeResponse)
async def get_me(
    db: AsyncSession = Depends(get_db), access: AccessContext = Depends(get_access_context)
) -> MeResponse:
    active_transfer = await transfer_request_crud.get_active_for_user(db, user_id=access.user.id)
    characters = await character_crud.list_for_user(db, user_id=access.user.id)
    regiments = await regiment_crud.get_all(db)

    return MeResponse(
        user=UserRead.model_validate(access.user),
        access=AccessInfo(
            is_admin=access.is_admin,
            is_password_login=access.is_password_login,
            is_real_admin=access.is_real_admin,
            can_use_view_as=access.can_use_view_as,
            is_high_command=access.is_high_command,
            is_instructor=access.is_instructor,
            can_grant_specializations=access.can_grant_specializations,
            instructor_disciplines=sorted(access.instructor_disciplines),
            is_universal_instructor=access.is_universal_instructor,
            is_regiment_leadership=access.is_regiment_leadership,
            commander_regiment_ids=sorted(access.commander_regiment_ids),
            category_manager_regiment_ids=sorted(access.category_manager_regiment_ids),
            soldier_regiment_ids=sorted(access.soldier_regiment_ids),
            report_appeal_regiment_ids=sorted(r.id for r in regiments if access.can_appeal_report(r.id)),
            can_write_violations=access.can_write_violations,
            can_view_violations=access.can_view_violations,
            can_send_broadcast=access.can_send_broadcast,
            can_file_detention_report=access.can_file_detention_report,
            can_manage_categories=access.can_manage_categories(),
            can_escalate_password_login=access.can_escalate_password_login,
            can_view_trainings=access.can_view_trainings,
            active_transfer=TransferRequestRead.model_validate(active_transfer) if active_transfer else None,
            characters=[CharacterRead.model_validate(c) for c in characters],
        ),
    )


@router.get("/me/view-as-candidates", response_model=list[GuildMemberRead])
async def get_view_as_candidates(access: AccessContext = Depends(get_access_context)) -> list[GuildMemberRead]:
    # for view-as-person picker (X-View-As-Discord-Id)
    if not access.can_use_view_as:
        raise ForbiddenError("Просмотр от лица доступен только администратору или высшему командованию")
    members = await discord_client.fetch_guild_members()
    return [
        GuildMemberRead(
            discord_id=m["discord_id"],
            username=m["username"],
            discord_username=m["username"],
            avatar_url=m["avatar_url"],
        )
        for m in members
    ]
