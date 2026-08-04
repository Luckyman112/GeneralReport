"""Стартовое звание формирования при регистрации

Revision ID: 0054
Revises: 0053
Create Date: 2026-08-04

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0054"
down_revision: Union[str, None] = "0053"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("regiments", sa.Column("starting_rank_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_regiments_starting_rank_id_ranks",
        "regiments",
        "ranks",
        ["starting_rank_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_regiments_starting_rank_id_ranks", "regiments", type_="foreignkey")
    op.drop_column("regiments", "starting_rank_id")
