"""Заявки на перевод между формированиями + дополнительные персонажи (Character)

Revision ID: 0045
Revises: 0044
Create Date: 2026-07-28

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0045"
down_revision: Union[str, None] = "0044"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "transfer_requests",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("from_regiment_id", sa.Integer(), sa.ForeignKey("regiments.id"), nullable=False),
        sa.Column("to_regiment_id", sa.Integer(), sa.ForeignKey("regiments.id"), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("approved_by_source_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("approved_by_source_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approved_by_target_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("approved_by_target_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("target_rank_id", sa.Integer(), sa.ForeignKey("ranks.id"), nullable=True),
        sa.Column("rejected_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("rejected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rejection_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "characters",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("regiment_id", sa.Integer(), sa.ForeignKey("regiments.id"), nullable=False),
        sa.Column("service_id", sa.String(length=4), nullable=True),
        sa.Column("callsign", sa.String(length=255), nullable=True),
        sa.Column("rank_id", sa.Integer(), sa.ForeignKey("ranks.id"), nullable=True),
        sa.Column("rank_assigned_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("steam_id", sa.String(length=64), nullable=True),
        sa.Column("is_inactive", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("user_id", "regiment_id", name="uq_character_user_regiment"),
    )


def downgrade() -> None:
    op.drop_table("characters")
    op.drop_table("transfer_requests")
