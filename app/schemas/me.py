from pydantic import BaseModel

from app.schemas.user import UserRead


class AccessInfo(BaseModel):
    is_admin: bool
    commander_regiment_ids: list[int]
    soldier_regiment_ids: list[int]


class MeResponse(BaseModel):
    user: UserRead
    access: AccessInfo
