from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.schemas.user import UserBrief


class AuditLogRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    action: str
    details: str
    created_at: datetime
    actor: UserBrief
