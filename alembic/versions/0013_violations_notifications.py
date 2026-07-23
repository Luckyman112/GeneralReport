"""violations, notifications, notification_reads + app_settings violation regiment lists

Revision ID: 0013
Revises: 0012
Create Date: 2026-07-23

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0013"
down_revision: Union[str, None] = "0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "app_settings",
        sa.Column("violation_writer_regiment_ids", sa.JSON(), nullable=False, server_default="[]"),
    )
    op.add_column(
        "app_settings",
        sa.Column("violation_viewer_regiment_ids", sa.JSON(), nullable=False, server_default="[]"),
    )

    op.create_table(
        "violations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("target_discord_id", sa.String(length=32), nullable=False),
        sa.Column("target_username", sa.String(length=255), nullable=False),
        sa.Column("target_regiment_id", sa.Integer(), sa.ForeignKey("regiments.id"), nullable=True),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "notifications",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("regiment_id", sa.Integer(), sa.ForeignKey("regiments.id"), nullable=True),
        sa.Column("violation_id", sa.Integer(), sa.ForeignKey("violations.id"), nullable=True),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "notification_reads",
        sa.Column("notification_id", sa.Integer(), sa.ForeignKey("notifications.id"), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), primary_key=True),
        sa.Column("read_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("notification_reads")
    op.drop_table("notifications")
    op.drop_table("violations")
    op.drop_column("app_settings", "violation_viewer_regiment_ids")
    op.drop_column("app_settings", "violation_writer_regiment_ids")
