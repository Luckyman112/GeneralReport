"""Флаг is_recruit_promotion на report_categories ("Курс молодого бойца")

Revision ID: 0076
Revises: 0075
Create Date: 2026-08-09

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0076"
down_revision: Union[str, None] = "0075"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "report_categories",
        sa.Column("is_recruit_promotion", sa.Boolean(), nullable=False, server_default="false"),
    )


def downgrade() -> None:
    op.drop_column("report_categories", "is_recruit_promotion")
