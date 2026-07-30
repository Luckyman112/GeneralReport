"""Бессрочный (постоянный) запрет на обучение специализации — until_date nullable

Revision ID: 0049
Revises: 0048
Create Date: 2026-07-30

"""
from typing import Sequence, Union

from alembic import op

revision: str = "0049"
down_revision: Union[str, None] = "0048"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("specialization_bans", "until_date", nullable=True)


def downgrade() -> None:
    op.alter_column("specialization_bans", "until_date", nullable=False)
