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
            commander_regiment_ids=sorted(access.commander_regiment_ids),
            soldier_regiment_ids=sorted(access.soldier_regiment_ids),
        ),
    )
