"""Ограничение на подачу рапорта категории: минимальное звание + "только зам+/командир"

Revision ID: 0046
Revises: 0045
Create Date: 2026-07-29

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0046"
down_revision: Union[str, None] = "0045"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("report_categories", sa.Column("min_rank_id", sa.Integer(), sa.ForeignKey("ranks.id"), nullable=True))
    op.add_column(
        "report_categories", sa.Column("commander_only", sa.Boolean(), nullable=False, server_default="false")
    )


def downgrade() -> None:
    op.drop_column("report_categories", "commander_only")
    op.drop_column("report_categories", "min_rank_id")
