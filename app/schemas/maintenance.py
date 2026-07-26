from pydantic import BaseModel


class MaintenanceStatusRead(BaseModel):
    enabled: bool
    message: str | None = None


class MaintenanceUpdate(BaseModel):
    enabled: bool
    message: str | None = None
