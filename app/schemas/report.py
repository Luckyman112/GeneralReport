import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.report import ReportStatus
from app.schemas.report_image import ReportImageRead
from app.schemas.user import UserBrief


class ReportCreate(BaseModel):
    regiment_id: int
    category_id: int | None = None
    content: str = Field(min_length=1)
    # Если True — рапорт сразу отправляется (submitted), иначе сохраняется как черновик
    submit: bool = False


class ReportStatusUpdate(BaseModel):
    """Изменение статуса рапорта командиром (одобрить/отклонить/удалить)."""

    status: ReportStatus
    rejection_reason: str | None = None


class ReportPointsUpdate(BaseModel):
    """Балл за рапорт — выставляет только полноправный командир."""

    points: int


class ReportRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: int
    regiment_id: int
    category_id: int | None
    content: str
    status: ReportStatus
    points: int | None
    images: list[ReportImageRead]
    created_at: datetime
    updated_at: datetime
    updated_by: int | None
    deleted_at: datetime | None
    rejection_reason: str | None
    author: UserBrief
    # Кто последним менял статус — "Рапорт одобрен: ..." имеет смысл показывать
    # только когда status == approved (проверяется на фронте по report.status)
    updated_by_user: UserBrief | None
