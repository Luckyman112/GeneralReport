"""Дисциплина в audit_logs — фильтр Журнала для DEP/CU по своей ветке

Revision ID: 0061
Revises: 0060
Create Date: 2026-08-07

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0061"
down_revision: Union[str, None] = "0060"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("audit_logs", sa.Column("discipline", sa.String(length=32), nullable=True))


def downgrade() -> None:
    op.drop_column("audit_logs", "discipline")
