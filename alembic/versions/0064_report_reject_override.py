"""Отдельная привилегия "может отклонить любой рапорт" (роль + люди)

Revision ID: 0064
Revises: 0063
Create Date: 2026-08-07

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0064"
down_revision: Union[str, None] = "0063"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "app_settings", sa.Column("report_reject_role_ids", sa.JSON(), nullable=False, server_default="[]")
    )
    op.add_column(
        "app_settings",
        sa.Column("report_reject_user_discord_ids", sa.JSON(), nullable=False, server_default="[]"),
    )


def downgrade() -> None:
    op.drop_column("app_settings", "report_reject_user_discord_ids")
    op.drop_column("app_settings", "report_reject_role_ids")
