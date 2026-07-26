"""Разделение баллов для повышения на админскую базу и командирскую надбавку

Revision ID: 0019
Revises: 0018
Create Date: 2026-07-26

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0019"
down_revision: Union[str, None] = "0018"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "promotion_requirements", sa.Column("admin_points_required", sa.Integer(), nullable=False, server_default="0")
    )


def downgrade() -> None:
    op.drop_column("promotion_requirements", "admin_points_required")
