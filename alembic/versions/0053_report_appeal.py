"""Право "обжаловать рапорт" — формирования/роли

Revision ID: 0053
Revises: 0052
Create Date: 2026-07-29

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0053"
down_revision: Union[str, None] = "0052"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "app_settings", sa.Column("report_appeal_regiment_ids", sa.JSON(), nullable=False, server_default="[]")
    )
    op.add_column(
        "app_settings", sa.Column("report_appeal_role_ids", sa.JSON(), nullable=False, server_default="[]")
    )


def downgrade() -> None:
    op.drop_column("app_settings", "report_appeal_role_ids")
    op.drop_column("app_settings", "report_appeal_regiment_ids")
