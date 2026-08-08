"""Розыск — публичный список, видимый всем бойцам

Revision ID: 0068
Revises: 0067
Create Date: 2026-08-08

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0068"
down_revision: Union[str, None] = "0067"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "wanted_entries",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("nickname", sa.String(length=255), nullable=False),
        sa.Column("service_id", sa.String(length=4), nullable=True),
        sa.Column("rank_id", sa.Integer(), nullable=True),
        sa.Column("regiment_id", sa.Integer(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=16), server_default="active", nullable=False),
        sa.Column("resolution", sa.String(length=16), nullable=True),
        sa.Column("created_by", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("resolved_by", sa.Integer(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["rank_id"], ["ranks.id"]),
        sa.ForeignKeyConstraint(["regiment_id"], ["regiments.id"]),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["resolved_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("wanted_entries")
