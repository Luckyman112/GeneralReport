from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, model_validator

from app.schemas.user import UserBrief


class LeaveRequestCreate(BaseModel):
    regiment_id: int
    start_date: date
    end_date: date
    reason: str

    @model_validator(mode="after")
    def _check_dates(self) -> "LeaveRequestCreate":
        if self.end_date < self.start_date:
            raise ValueError("Дата окончания не может быть раньше даты начала")
        return self


class LeaveRequestRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    regiment_id: int
    start_date: date
    end_date: date
    reason: str
    status: str
    created_at: datetime
    decided_at: datetime | None
    user: UserBrief
