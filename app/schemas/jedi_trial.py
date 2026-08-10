from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.schemas.user import UserBrief


class JediTrialRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    trial_number: int
    passed_at: datetime
    passed_by: UserBrief


class JediTrialProgressRead(BaseModel):
    """Полная картина для бойца: что уже сдано + когда доступно следующее
    испытание/аттестация на Рыцаря (None — либо всё сдано, либо ранг не
    Падаван, см. app/api/regiments.py)."""

    trials: list[JediTrialRead]
    next_trial_number: int | None
    next_trial_available_at: datetime | None
    graduation_available_at: datetime | None
