"""Начальная схема: users, regiments, reports

Revision ID: 0001
Revises:
Create Date: 2026-07-22

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("discord_id", sa.String(length=32), nullable=False),
        sa.Column("username", sa.String(length=255), nullable=False),
        sa.Column("avatar_url", sa.String(length=512), nullable=True),
        sa.Column("roles", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("discord_id"),
    )
    op.create_index("ix_users_discord_id", "users", ["discord_id"])

    op.create_table(
        "regiments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("discord_role_id", sa.String(length=32), nullable=False),
        sa.Column("commander_role_id", sa.String(length=32), nullable=False),
        sa.UniqueConstraint("name"),
        sa.UniqueConstraint("discord_role_id"),
        sa.UniqueConstraint("commander_role_id"),
    )

    report_status = postgresql.ENUM(
        "draft", "submitted", "approved", "rejected", "deleted", name="report_status", create_type=False
    )
    report_status.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "reports",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("regiment_id", sa.Integer(), sa.ForeignKey("regiments.id"), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("status", report_status, nullable=False, server_default="draft"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("updated_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rejection_reason", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("reports")
    postgresql.ENUM(name="report_status").drop(op.get_bind(), checkfirst=True)
    op.drop_table("regiments")
    op.drop_index("ix_users_discord_id", table_name="users")
    op.drop_table("users")
