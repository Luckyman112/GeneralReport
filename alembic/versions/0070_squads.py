"""Отряды — подгруппы внутри формирования со своей мини-лестницей титулов

Revision ID: 0070
Revises: 0069
Create Date: 2026-08-08

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0070"
down_revision: Union[str, None] = "0069"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "squads",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("regiment_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("tier_labels", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["regiment_id"], ["regiments.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("regiment_id", "name", name="uq_squad_name_per_regiment"),
    )
    op.create_table(
        "squad_memberships",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("squad_id", sa.Integer(), nullable=False),
        sa.Column("discord_id", sa.String(length=32), nullable=False),
        sa.Column("username", sa.String(length=255), nullable=False),
        sa.Column("tier", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["squad_id"], ["squads.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("squad_id", "discord_id", name="uq_squad_membership"),
    )


def downgrade() -> None:
    op.drop_table("squad_memberships")
    op.drop_table("squads")
