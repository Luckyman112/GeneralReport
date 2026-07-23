"""Категории рапортов, явное назначение командиров формирований

Revision ID: 0004
Revises: 0003
Create Date: 2026-07-23

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "report_categories",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("regiment_id", sa.Integer(), sa.ForeignKey("regiments.id"), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.UniqueConstraint("regiment_id", "name", name="uq_report_category_name"),
    )

    op.create_table(
        "regiment_commanders",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("regiment_id", sa.Integer(), sa.ForeignKey("regiments.id"), nullable=False),
        sa.Column("discord_id", sa.String(length=32), nullable=False),
        sa.Column("username", sa.String(length=255), nullable=False),
        sa.UniqueConstraint("regiment_id", "discord_id", name="uq_regiment_commander"),
    )

    op.add_column(
        "reports",
        sa.Column("category_id", sa.Integer(), sa.ForeignKey("report_categories.id"), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("reports", "category_id")
    op.drop_table("regiment_commanders")
    op.drop_table("report_categories")
