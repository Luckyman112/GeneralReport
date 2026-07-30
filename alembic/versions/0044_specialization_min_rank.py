"""Минимальное звание для обучения специализации

Revision ID: 0044
Revises: 0043
Create Date: 2026-07-27

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0044"
down_revision: Union[str, None] = "0043"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("specializations", sa.Column("min_rank_id", sa.Integer(), sa.ForeignKey("ranks.id"), nullable=True))


def downgrade() -> None:
    op.drop_column("specializations", "min_rank_id")
