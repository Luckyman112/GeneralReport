from pydantic import BaseModel

from app.schemas.user import UserRead


class AccessInfo(BaseModel):
    is_admin: bool
    is_password_login: bool
    commander_regiment_ids: list[int]
    category_manager_regiment_ids: list[int]
    soldier_regiment_ids: list[int]


class MeResponse(BaseModel):
    user: UserRead
    access: AccessInfo
