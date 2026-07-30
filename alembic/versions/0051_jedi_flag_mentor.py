"""Флаг "джедай" на персонаже и составе + список формирований-источников
наставников

Revision ID: 0051
Revises: 0050
Create Date: 2026-07-31

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0051"
down_revision: Union[str, None] = "0050"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

JEDI_TIER_NAMES = ["Джедаи — Старший офицерский состав", "Джедаи — Высший офицерский состав"]


def upgrade() -> None:
    op.add_column("characters", sa.Column("is_jedi", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("rank_tiers", sa.Column("is_jedi", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column(
        "app_settings", sa.Column("mentor_source_regiment_ids", sa.JSON(), nullable=False, server_default="[]")
    )

    connection = op.get_bind()
    connection.execute(
        sa.text("UPDATE rank_tiers SET is_jedi = true WHERE name = ANY(:names)"),
        {"names": JEDI_TIER_NAMES},
    )


def downgrade() -> None:
    op.drop_column("app_settings", "mentor_source_regiment_ids")
    op.drop_column("rank_tiers", "is_jedi")
    op.drop_column("characters", "is_jedi")
