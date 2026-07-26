"""app_settings: high_command_role_id + role-based lists for violations/broadcast/detention

Revision ID: 0015
Revises: 0014
Create Date: 2026-07-25

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0015"
down_revision: Union[str, None] = "0014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("app_settings", sa.Column("high_command_role_id", sa.String(length=32), nullable=True))
    op.add_column(
        "app_settings",
        sa.Column("violation_writer_role_ids", sa.JSON(), nullable=False, server_default="[]"),
    )
    op.add_column(
        "app_settings",
        sa.Column("violation_viewer_role_ids", sa.JSON(), nullable=False, server_default="[]"),
    )
    op.add_column("app_settings", sa.Column("broadcast_role_ids", sa.JSON(), nullable=False, server_default="[]"))
    op.add_column(
        "app_settings",
        sa.Column("detention_report_role_ids", sa.JSON(), nullable=False, server_default="[]"),
    )
    op.add_column(
        "app_settings",
        sa.Column("detention_report_user_discord_ids", sa.JSON(), nullable=False, server_default="[]"),
    )


def downgrade() -> None:
    op.drop_column("app_settings", "detention_report_user_discord_ids")
    op.drop_column("app_settings", "detention_report_role_ids")
    op.drop_column("app_settings", "broadcast_role_ids")
    op.drop_column("app_settings", "violation_viewer_role_ids")
    op.drop_column("app_settings", "violation_writer_role_ids")
    op.drop_column("app_settings", "high_command_role_id")
