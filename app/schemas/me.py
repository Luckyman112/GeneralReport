from pydantic import BaseModel

from app.schemas.character import CharacterRead
from app.schemas.transfer_request import TransferRequestRead
from app.schemas.user import UserRead


class AccessInfo(BaseModel):
    is_admin: bool
    is_founder: bool = False
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
    # DEP+/CU дисциплины (см. InstructorRole.tier) — фронт открывает по ним
    # расширенные разделы (каталог своей ветки, кросс-формационный ростер и т.д.)
    deputy_disciplines: list[str] = []
    curator_disciplines: list[str] = []
    # дисциплины, где у САМОГО пользователя есть специализация (обучен на
    # ветку) — доступ к разделам Специализации (Медицина/Инженерия), см.
    # AccessContext.can_access_discipline
    specialization_disciplines: list[str] = []
    # Отряды (в любых формированиях), где состоит человек — определяет, какие
    # отрядные категории рапорта видны в общей форме (см. ReportForm.jsx)
    squad_ids: list[int] = []
    # командир/заместитель хотя бы одного формирования — открывает Штаб-категории
    # с open_to_regiment_leadership, даже если сам не состоит в Штабе
    is_regiment_leadership: bool = False
    commander_regiment_ids: list[int]
    category_manager_regiment_ids: list[int]
    soldier_regiment_ids: list[int]
    # id "17-ый Передовой Полк" — None, если не настроен (см. страницу "Рекрутская")
    recruit_regiment_id: int | None = None
    # extends can_appeal_report beyond commander_regiment_ids
    report_appeal_regiment_ids: list[int] = []
    # отдельная привилегия "отклонить любой рапорт" — не связана с командованием
    can_reject_any_report: bool = False
    can_write_violations: bool
    can_view_violations: bool
    can_send_broadcast: bool
    can_file_detention_report: bool
    can_manage_categories: bool
    can_escalate_password_login: bool
    can_view_trainings: bool
    # Ивентрум — независимая ролевая система (Ивентолог/Ассистент/Куратор)
    is_event_submitter: bool = False
    is_event_assistant: bool = False
    is_event_curator: bool = False
    can_decide_event: bool = False
    can_access_event_room: bool = False
    active_transfer: TransferRequestRead | None = None
    characters: list[CharacterRead] = []


class MeResponse(BaseModel):
    user: UserRead
    access: AccessInfo
