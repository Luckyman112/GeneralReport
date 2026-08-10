from pydantic import BaseModel, ConfigDict


class ModuleAccessRead(BaseModel):
    """Кто может писать/видеть нарушения, рассылать объявления и видеть кнопку
    рапорта о задержании — настраивает любой администратор (не только по паролю)."""

    model_config = ConfigDict(from_attributes=True)

    violation_writer_regiment_ids: list[int]
    violation_writer_role_ids: list[str]
    violation_viewer_regiment_ids: list[int]
    violation_viewer_role_ids: list[str]
    broadcast_role_ids: list[str]
    detention_report_role_ids: list[str]
    detention_report_user_discord_ids: list[str]
    training_viewer_role_ids: list[str]
    mentor_source_regiment_ids: list[int]
    report_appeal_regiment_ids: list[int]
    report_appeal_role_ids: list[str]
    event_role_id: str | None
    event_assistant_role_id: str | None
    event_curator_role_id: str | None
    event_notify_channel_id: str | None
    event_notify_ping_role_id: str | None
    report_reject_role_ids: list[str]
    report_reject_user_discord_ids: list[str]
    admin_staff_junior_role_id: str | None
    admin_staff_middle_role_id: str | None
    admin_staff_warden_role_id: str | None
    admin_staff_assistant_role_id: str | None
    admin_staff_curator_role_id: str | None
    admin_staff_responsible_middle_discord_ids: list[str]


class ModuleAccessUpdate(BaseModel):
    """Поля, отсутствующие в теле запроса, не изменяются (exclude_unset в эндпоинте)."""

    violation_writer_regiment_ids: list[int] | None = None
    violation_writer_role_ids: list[str] | None = None
    violation_viewer_regiment_ids: list[int] | None = None
    violation_viewer_role_ids: list[str] | None = None
    broadcast_role_ids: list[str] | None = None
    detention_report_role_ids: list[str] | None = None
    detention_report_user_discord_ids: list[str] | None = None
    training_viewer_role_ids: list[str] | None = None
    report_appeal_regiment_ids: list[int] | None = None
    report_appeal_role_ids: list[str] | None = None
    mentor_source_regiment_ids: list[int] | None = None
    event_role_id: str | None = None
    event_assistant_role_id: str | None = None
    event_curator_role_id: str | None = None
    event_notify_channel_id: str | None = None
    event_notify_ping_role_id: str | None = None
    report_reject_role_ids: list[str] | None = None
    report_reject_user_discord_ids: list[str] | None = None
    admin_staff_junior_role_id: str | None = None
    admin_staff_middle_role_id: str | None = None
    admin_staff_warden_role_id: str | None = None
    admin_staff_assistant_role_id: str | None = None
    admin_staff_curator_role_id: str | None = None
    admin_staff_responsible_middle_discord_ids: list[str] | None = None
