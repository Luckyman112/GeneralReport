import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.report import ReportStatus


class ReportCreate(BaseModel):
    regiment_id: int
    content: str = Field(min_length=1)
    # Если True — рапорт сразу отправляется (submitted), иначе сохраняется как черновик
    submit: bool = False


class ReportStatusUpdate(BaseModel):
    """Изменение статуса рапорта командиром (одобрить/отклонить/удалить)."""

    status: ReportStatus
    rejection_reason: str | None = None


class ReportRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: int
    regiment_id: int
    content: str
    status: ReportStatus
    created_at: datetime
    updated_at: datetime
    updated_by: int | None
    deleted_at: datetime | None
    rejection_reason: str | None
