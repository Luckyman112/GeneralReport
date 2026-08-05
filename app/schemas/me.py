from pydantic import BaseModel

from app.schemas.character import CharacterRead
from app.schemas.transfer_request import TransferRequestRead
from app.schemas.user import UserRead


class AccessInfo(BaseModel):
    is_admin: bool
    is_password_login: bool
    is_real_admin: bool = False
    can_use_view_as: bool = False
    is_high_command: bool
    is_instructor: bool = False
    can_grant_specializations: bool = False
    # дисциплины (медик/пилот/инженер), которые этот инструктор может выдавать —
    # фронт использует, чтобы сузить список специализаций в форме выдачи
    instructor_disciplines: list[str] = []
    is_universal_instructor: bool = False
    commander_regiment_ids: list[int]
    category_manager_regiment_ids: list[int]
    soldier_regiment_ids: list[int]
    # extends can_appeal_report beyond commander_regiment_ids
    report_appeal_regiment_ids: list[int] = []
    can_write_violations: bool
    can_view_violations: bool
    can_send_broadcast: bool
    can_file_detention_report: bool
    can_manage_categories: bool
    can_escalate_password_login: bool
    can_view_trainings: bool
    active_transfer: TransferRequestRead | None = None
    characters: list[CharacterRead] = []


class MeResponse(BaseModel):
    user: UserRead
    access: AccessInfo
