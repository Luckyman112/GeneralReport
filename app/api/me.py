"""Информация о текущем пользователе и его уровне доступа — нужна фронтенду для UI."""
from fastapi import APIRouter, Depends

from app.api.deps import AccessContext, get_access_context
from app.schemas.me import AccessInfo, MeResponse
from app.schemas.user import UserRead

router = APIRouter(tags=["me"])


@router.get("/me", response_model=MeResponse)
async def get_me(access: AccessContext = Depends(get_access_context)) -> MeResponse:
    return MeResponse(
        user=UserRead.model_validate(access.user),
        access=AccessInfo(
            is_admin=access.is_admin,
            is_password_login=access.is_password_login,
            is_real_admin=access.is_real_admin,
            is_high_command=access.is_high_command,
            commander_regiment_ids=sorted(access.commander_regiment_ids),
            category_manager_regiment_ids=sorted(access.category_manager_regiment_ids),
            soldier_regiment_ids=sorted(access.soldier_regiment_ids),
            can_write_violations=access.can_write_violations,
            can_view_violations=access.can_view_violations,
            can_send_broadcast=access.can_send_broadcast,
            can_file_detention_report=access.can_file_detention_report,
            can_manage_categories=access.can_manage_categories(),
        ),
    )
