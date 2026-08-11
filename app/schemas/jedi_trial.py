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
    испытание (None — либо всё сдано включая аттестацию, либо ранг не
    Падаван, см. app/api/regiments.py). 6-е испытание — сама аттестация на
    Рыцаря, тот же механизм, что и 1-5 (см. app/crud/jedi_trial.py), поэтому
    отдельного graduation_available_at больше нет — next_trial_available_at
    покрывает и его, когда next_trial_number == 6."""

    trials: list[JediTrialRead]
    next_trial_number: int | None
    next_trial_available_at: datetime | None
