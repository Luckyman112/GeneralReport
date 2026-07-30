from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.rank import RankRead
from app.schemas.regiment import RegimentRead
from app.schemas.user import UserBrief


class TransferRequestCreate(BaseModel):
    to_regiment_id: int
    reason: str = Field(min_length=1)


class TransferRequestRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user: UserBrief
    from_regiment: RegimentRead
    to_regiment: RegimentRead
    reason: str
    status: str
    approved_by_source: UserBrief | None = None
    approved_by_source_at: datetime | None = None
    approved_by_target: UserBrief | None = None
    approved_by_target_at: datetime | None = None
    target_rank: RankRead | None = None
    rejected_by: UserBrief | None = None
    rejected_at: datetime | None = None
    rejection_reason: str | None = None
    created_at: datetime


class TransferApproveTargetRequest(BaseModel):
    target_rank_id: int


class TransferRejectRequest(BaseModel):
    reason: str | None = None
