from pydantic import BaseModel, ConfigDict


class AppSettingsRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    admin_role_id: str | None
    commander_role_id: str | None
    deputy_role_id: str | None


class AppSettingsUpdate(BaseModel):
    admin_role_id: str | None = None
    commander_role_id: str | None = None
    deputy_role_id: str | None = None
