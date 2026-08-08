"""Формирования — заморозка (is_archived) вместо удаления

Revision ID: 0069
Revises: 0068
Create Date: 2026-08-08

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0069"
down_revision: Union[str, None] = "0068"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("regiments", sa.Column("is_archived", sa.Boolean(), server_default="false", nullable=False))


def downgrade() -> None:
    op.drop_column("regiments", "is_archived")
