from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.user import UserBrief


class ReprimandCreate(BaseModel):
    target_discord_id: str
    reason: str = Field(min_length=1)
    severity: Literal["verbal", "strict"] = "strict"
    points_required: int = 0


class ReprimandRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    regiment_id: int
    reason: str
    severity: str
    points_required: int
    auto_escalated: bool
    issued_at: datetime
    revoked_at: datetime | None
    target: UserBrief
    issuer: UserBrief
    # Сколько баллов набрано с момента выдачи (за одобренные рапорты) — для
    # самостоятельного снятия бойцом и для прогресс-бара
    points_earned: int = 0
    # Пояснение/апелляция бойца — правит только сам боец (см. PATCH .../appeal)
    appeal_text: str | None = None


class ReprimandAppealUpdate(BaseModel):
    appeal_text: str = Field(min_length=1, max_length=2000)
