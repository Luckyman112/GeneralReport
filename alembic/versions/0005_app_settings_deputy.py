"""app_settings (роли админ/командир/зам через веб) + role_type у командиров формирований

Revision ID: 0005
Revises: 0004
Create Date: 2026-07-23

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: Union[str, None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "app_settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("admin_role_id", sa.String(length=32), nullable=True),
        sa.Column("commander_role_id", sa.String(length=32), nullable=True),
        sa.Column("deputy_role_id", sa.String(length=32), nullable=True),
    )

    op.add_column(
        "regiment_commanders",
        sa.Column("role_type", sa.String(length=16), nullable=False, server_default="commander"),
    )
    op.alter_column("regiment_commanders", "role_type", server_default=None)


def downgrade() -> None:
    op.drop_column("regiment_commanders", "role_type")
    op.drop_table("app_settings")
