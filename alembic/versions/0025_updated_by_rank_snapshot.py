"""Снимок звания того, кто менял статус рапорта (для архивного "Рапорт одобрен")

Revision ID: 0025
Revises: 0024
Create Date: 2026-07-27

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0025"
down_revision: Union[str, None] = "0024"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "reports",
        sa.Column("updated_by_rank_id", sa.Integer(), sa.ForeignKey("ranks.id"), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("reports", "updated_by_rank_id")
