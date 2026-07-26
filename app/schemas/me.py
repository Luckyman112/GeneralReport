from pydantic import BaseModel

from app.schemas.user import UserRead


class AccessInfo(BaseModel):
    is_admin: bool
    is_password_login: bool
    is_real_admin: bool = False
    is_high_command: bool
    commander_regiment_ids: list[int]
    category_manager_regiment_ids: list[int]
    soldier_regiment_ids: list[int]
    can_write_violations: bool
    can_view_violations: bool
    can_send_broadcast: bool
    can_file_detention_report: bool
    can_manage_categories: bool


class MeResponse(BaseModel):
    user: UserRead
    access: AccessInfo
