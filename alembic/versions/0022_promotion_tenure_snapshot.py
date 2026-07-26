"""Снимок начала выслуги в заявке на повышение (для истории/обзора после того,
как rank_assigned_at перезапишется новым повышением)

Revision ID: 0022
Revises: 0021
Create Date: 2026-07-26

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0022"
down_revision: Union[str, None] = "0021"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("promotion_requests", sa.Column("tenure_started_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("promotion_requests", "tenure_started_at")
