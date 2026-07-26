"""Ручная выдача баллов бойцу администратором/высшим командованием (в обход рапортов)

Revision ID: 0023
Revises: 0022
Create Date: 2026-07-26

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0023"
down_revision: Union[str, None] = "0022"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "points_adjustments",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("regiment_id", sa.Integer(), sa.ForeignKey("regiments.id"), nullable=False),
        sa.Column("points", sa.Integer(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("points_adjustments")
